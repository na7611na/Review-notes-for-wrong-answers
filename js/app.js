import { SUBJECTS, SUBJECT_KEYS, GRADES, BANDS, bandOf, REASONS, ENCOURAGE, PRAISE, pick } from "./data.js";
import { unitsFor, findUnit, drawProblems } from "./bank.js";
import * as DB from "./db.js";
import { initAI, analyzeProblem, moreProblems, cleanProblem, problemTextOf, correctAnswerOf } from "./ai.js";
import { $app, state, esc, go, fmtDate, toast, loading, modal, confirmBox, layout, subjChip, subjVars, statusBadge, noteById } from "./ui.js";
import { typeOf, isMulti, answerInput, answerText, autoGrade, hasAnswer, gradeParts, partsHtml, bindAnswers } from "./answer.js";
import { renderExams, renderExamNew, renderExam, renderPrint, forgetImage, chapterOf } from "./exam.js";
import { openCropper } from "./cropper.js";
import { CURRICULUM, termsOf, currentTerm, termOfChapter } from "./curriculum.js";

// 사진을 JPEG로 줄이기 (Firestore 문서 1MB 제한 + 무료 용량 절약)
function loadImage(file) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img); img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}
function toJpeg(img, maxDim, quality) {
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
// img: 사진 또는 자른 canvas
function compressPhoto(img) {
  let dim = 1400, q = 0.75, data = toJpeg(img, dim, q);
  while (data.length > 650_000 && dim > 600) { dim -= 200; q -= 0.05; data = toJpeg(img, dim, q); }
  return { image: data, thumb: toJpeg(img, 260, 0.6) };
}

// AI 분석 결과 중 오답노트에 저장할 부분
const aiFields = (r) => ({
  source: "ai", original: r.original, problemText: r.problemText, correctAnswer: r.correctAnswer,
  unit: r.unit, chapter: r.chapter, aiChapter: r.chapter, concept: r.concept, firstSet: r.problems,
});

// AI가 알려 준 그림 영역([ymin, xmin, ymax, xmax], 0~1000)만 사진에서 잘라낸다
async function cropFigure(src, box) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [y0, x0, y1, x1] = box.map((v) => Math.min(1000, Math.max(0, v)) / 1000);
  const pad = 0.015;
  const sx = Math.max(0, x0 - pad) * img.width, sy = Math.max(0, y0 - pad) * img.height;
  const sw = Math.min(1, x1 + pad) * img.width - sx, sh = Math.min(1, y1 + pad) * img.height - sy;
  if (sw < 20 || sh < 20) return null;
  const c = document.createElement("canvas");
  c.width = Math.round(sw); c.height = Math.round(sh);
  c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

// 사진을 AI로 분석해 오답노트에 저장할 값 + 잘라낸 그림을 돌려준다 (실패하면 예외)
async function runAnalysis({ image, subject, reasons, memo, chapter }) {
  const r = await analyzeProblem({ imageBase64: image.split(",")[1], subject, grade: state.profile?.grade || "중1", reasons, memo, bankUnits: unitsFor(subject, state.custom), chapter });
  const figure = r.original.figureBox ? await cropFigure(image, r.original.figureBox).catch(() => null) : null;
  return { fields: { ...aiFields(r), bankUnitId: r.bankUnitId, hasFigureImg: !!figure }, figure };
}

// AI가 실패한 까닭을 알기 쉽게
function aiErrorMessage(e) {
  const m = String(e?.message || e);
  if (m.includes("UNREADABLE")) return "사진에서 문제를 읽지 못했어요. 밝은 곳에서 한 문제만 다시 찍어 보세요.";
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(m)) return "오늘 AI 무료 사용량을 다 썼어요.";
  if (/403|permission|API has not been used|disabled|PERMISSION_DENIED|api-not-enabled/i.test(m)) return "Firebase AI Logic(5단계) 설정을 확인해 주세요.";
  if (/network|fetch|Failed to fetch/i.test(m)) return "인터넷 연결을 확인해 주세요.";
  if (/genai config not found/i.test(m)) return "Firebase AI Logic 설정이 끝나지 않았어요 (콘솔 > AI Logic에서 Gemini Developer API 설정 완료).";
  if (m.includes("NOT_SAME_TYPE")) return "AI가 원래 문제와 같은 유형의 문제를 만들지 못했어요.";
  if (/404|not found/i.test(m)) return "AI 모델 이름을 찾지 못했어요(설정 파일의 AI_MODELS 확인).";
  return "AI가 지금은 문제를 분석하지 못했어요 (" + m.slice(0, 80) + ").";
}

// ---------------------------------------------------------- 단원 고르기 (2022 개정 교육과정)
// 기타에서 직접 입력한 단원은 프로필에 저장해 다음부터 선택지에 나온다
async function rememberChapter(subject, chapter) {
  if (!chapter) return;
  const all = { ...(state.profile.chapters || {}) };
  const list = all[subject] || [];
  if (list.includes(chapter)) return;
  all[subject] = [chapter, ...list].slice(0, 60);
  state.profile.chapters = all;
  await DB.saveProfile(state.uid, { chapters: all }).catch((e) => console.warn("단원 저장 실패", e));
}
const isCurriculum = (subject, sel) => !!sel.term && (CURRICULUM[subject][sel.term] || []).includes(sel.chapter);

/**
 * 학년·학기 → 단원 고르기. 목록에 없으면 "기타"에서 직접 입력.
 * sel = { term, chapter } 를 직접 바꾸고, 바뀔 때마다 onChange 호출
 */
function mountChapterPicker(box, subject, sel, onChange = () => {}) {
  const ui = { term: sel.term || termOfChapter(subject, sel.chapter) || currentTerm(subject, state.profile?.grade), etc: false };
  const draw = () => {
    const list = CURRICULUM[subject][ui.term] || [];
    const mine = state.profile?.chapters?.[subject] || [];
    const custom = !!sel.chapter && !isCurriculum(subject, sel);
    const openEtc = ui.etc || custom;
    box.innerHTML = `
      <label class="term-pick">학년·학기
        <select data-term>${termsOf(subject).map((t) => `<option ${t === ui.term ? "selected" : ""}>${t}</option>`).join("")}</select>
      </label>
      <div class="chip-row chapter-row">
        ${list.map((c) => `<button class="ch-chip ${sel.term === ui.term && sel.chapter === c ? "on" : ""}" data-chapter="${esc(c)}">${esc(c)}</button>`).join("")}
        <button class="ch-chip etc ${openEtc ? "on" : ""}" data-chetc>✏️ 기타 (직접 입력)</button>
      </div>
      ${openEtc ? `<div class="etc-box">
        ${mine.length ? `<p class="muted small">내가 입력한 단원</p><div class="chip-row">${mine.map((c) => `<button class="ch-chip ${custom && sel.chapter === c ? "on" : ""}" data-mine="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
        <div class="ch-add"><input placeholder="단원 이름 입력 (예: 소인수분해)" maxlength="30" data-newch><button class="btn small" data-addch>추가</button></div>
      </div>` : ""}
      ${sel.chapter ? `<p class="picked">✔ <b>${esc(sel.term ? `${sel.term} · ${sel.chapter}` : sel.chapter)}</b> <button class="link" data-clear>선택 취소</button></p>`
        : `<p class="muted small">고르지 않으면 AI가 단원을 정해요.</p>`}`;
    const set = (term, chapter) => { sel.term = term; sel.chapter = chapter; onChange(sel); draw(); };
    box.querySelector("[data-term]").onchange = (e) => { ui.term = e.target.value; draw(); };
    box.querySelectorAll("[data-chapter]").forEach((b) => b.onclick = () => set(ui.term, b.dataset.chapter));
    box.querySelectorAll("[data-mine]").forEach((b) => b.onclick = () => set(null, b.dataset.mine));
    box.querySelector("[data-chetc]").onclick = () => { ui.etc = !openEtc; if (!ui.etc && custom) set(null, ""); else draw(); };
    box.querySelector("[data-clear]")?.addEventListener("click", () => set(null, ""));
    const inp = box.querySelector("[data-newch]");
    if (inp) {
      const add = () => { const v = inp.value.trim(); if (v) set(null, v); };
      box.querySelector("[data-addch]").onclick = add;
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } };
    }
  };
  draw();
}

// ---------------------------------------------------------- 라우터
async function render() {
  if (!DB.isConfigured) return renderSetup();
  if (!state.uid) return renderAuth();
  const [, route, param] = (location.hash || "#/home").split("/");
  const [id] = (param || "").split("?");
  const params = new URLSearchParams((route || "").split("?")[1] || "");
  switch ((route || "home").split("?")[0]) {
    case "subject": return renderSubject(id);
    case "new": return renderNew(params.get("subject"));
    case "note": return renderNote(id);
    case "practice": return renderPractice(id);
    case "exams": return renderExams();
    case "exam-new": return renderExamNew({ subject: params.get("subject") || undefined });
    case "exam": return renderExam(id);
    case "print": return renderPrint(id);
    case "settings": return renderSettings();
    case "bank": return renderBank();
    default: return renderHome();
  }
}
window.addEventListener("hashchange", render);

// ---------------------------------------------------------- 설정 전 안내
function renderSetup() {
  $app.innerHTML = `
    <main class="page narrow">
      <div class="hero-card">
        <div class="logo">📒</div>
        <h1>오답노트 설정이 필요해요</h1>
        <p class="muted">아직 Firebase가 연결되지 않았어요.<br>저장소의 <b>README.md</b> 안내에 따라 <code>js/firebase-config.js</code> 파일에 Firebase 설정값을 넣어 주세요.</p>
      </div>
    </main>`;
}

// ---------------------------------------------------------- 로그인 / 회원가입
function renderAuth(mode = "login") {
  const isLogin = mode === "login";
  $app.innerHTML = `
    <main class="page narrow">
      <div class="hero-card">
        <div class="logo">📒</div>
        <h1>나만의 오답노트</h1>
        <p class="muted">틀린 문제는 실력이 자라는 자리예요 🌱</p>
      </div>
      <div class="card">
        <div class="tabs">
          <button class="tab ${isLogin ? "on" : ""}" data-mode="login">로그인</button>
          <button class="tab ${!isLogin ? "on" : ""}" data-mode="signup">회원가입</button>
        </div>
        <form id="authForm" class="form">
          <label>아이디<input name="id" autocomplete="username" placeholder="영어 소문자·숫자 4~20자" required></label>
          <label>비밀번호<input name="pw" type="password" autocomplete="${isLogin ? "current-password" : "new-password"}" placeholder="6자 이상" required></label>
          ${isLogin ? "" : `
          <label>비밀번호 확인<input name="pw2" type="password" autocomplete="new-password" required></label>
          <label>이름(별명)<input name="name" maxlength="12" placeholder="예: 민준" required></label>
          <label>학년<select name="grade">${GRADES.map((g) => `<option ${g === "중1" ? "selected" : ""}>${g}</option>`).join("")}</select></label>`}
          <p class="error" id="authErr"></p>
          <button class="btn primary big" type="submit">${isLogin ? "로그인" : "가입하고 시작하기"}</button>
        </form>
      </div>
    </main>`;
  $app.querySelectorAll(".tab").forEach((b) => b.onclick = () => renderAuth(b.dataset.mode));
  $app.querySelector("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $app.querySelector("#authErr");
    const id = f.id.trim().toLowerCase();
    if (!DB.ID_RULE.test(id)) { err.textContent = "아이디는 영어 소문자, 숫자, _ 로 4~20자예요."; return; }
    if (!isLogin && f.pw !== f.pw2) { err.textContent = "비밀번호가 서로 달라요."; return; }
    loading(true, isLogin ? "로그인 중…" : "계정을 만드는 중…");
    try {
      if (isLogin) await DB.login(id, f.pw);
      else await DB.signup(id, f.pw, f.name.trim(), f.grade);
    } catch (ex) { err.textContent = DB.authErrorMessage(ex); }
    loading(false);
  };
}

// ---------------------------------------------------------- 홈
function renderHome() {
  const p = state.profile || {};
  const learning = state.notes.filter((n) => n.status !== "done");
  const done = state.notes.length - learning.length;
  layout(`
    <header class="greet">
      <div>
        <p class="muted">${esc(p.grade || "")}</p>
        <h1>${esc(p.name || "")}님, 오늘도 한 문제씩! 🌱</h1>
      </div>
    </header>
    <section class="stats">
      <div class="stat"><b>${learning.length}</b><span>학습 중</span></div>
      <div class="stat"><b>${done}</b><span>학습 완료</span></div>
      <div class="stat"><b>${state.notes.length}</b><span>전체 오답</span></div>
    </section>
    <a class="cta" href="#/new">
      <span class="cta-icon">📷</span>
      <span><b>틀린 문제 찍기</b><small>사진만 찍으면 개념 정리와 동일 유형 문제가 준비돼요</small></span>
      <span class="arrow">›</span>
    </a>
    <a class="cta soft" href="#/exams">
      <span class="cta-icon">📝</span>
      <span><b>맞춤형 문제</b><small>틀린 문제를 모아 새 시험지처럼 다시 풀어요 · 인쇄 가능</small></span>
      <span class="arrow">›</span>
    </a>
    <h2 class="sec-title">과목별 오답노트</h2>
    <section class="subject-grid">
      ${SUBJECT_KEYS.map((k) => {
        const list = state.notes.filter((n) => n.subject === k);
        const l = list.filter((n) => n.status !== "done").length;
        return `<a class="subject-card" href="#/subject/${k}" style="${subjVars(k)}">
          <span class="s-icon">${SUBJECTS[k].icon}</span>
          <b>${SUBJECTS[k].name}</b>
          <small>학습 중 ${l} · 완료 ${list.length - l}</small>
        </a>`;
      }).join("")}
    </section>
    ${learning.length ? `<h2 class="sec-title">다시 풀어 볼 문제</h2>
      <section class="note-list">${learning.slice(0, 5).map(noteCard).join("")}</section>` : ""}
  `, "home");
}

function noteCard(n) {
  return `<a class="note-card" href="#/note/${n.id}">
    <img class="thumb" src="${n.thumb}" alt="">
    <div class="nc-body">
      <div class="nc-top">${subjChip(n.subject)} ${statusBadge(n)}</div>
      <b class="nc-title">${esc(n.unit || "단원 미정")}</b>
      <small class="muted">${fmtDate(n.createdAt)} · ${n.reasons?.length ? esc(n.reasons[0]) + (n.reasons.length > 1 ? ` 외 ${n.reasons.length - 1}개` : "") : "틀린 이유 미선택"}</small>
    </div>
  </a>`;
}

// ---------------------------------------------------------- 과목별 목록
function renderSubject(key, filter = "learning") {
  if (!SUBJECTS[key]) return go("#/home");
  const s = SUBJECTS[key];
  const all = state.notes.filter((n) => n.subject === key);
  const list = filter === "all" ? all : all.filter((n) => (filter === "done" ? n.status === "done" : n.status !== "done"));
  layout(`
    <header class="subject-head" style="${subjVars(key)}">
      <a href="#/home" class="back">‹</a>
      <span class="s-icon">${s.icon}</span><h1>${s.name} 오답노트</h1>
    </header>
    <div class="tabs pill">
      ${[["learning", "학습 중"], ["done", "학습 완료"], ["all", "전체"]].map(([v, t]) => `<button class="tab ${filter === v ? "on" : ""}" data-f="${v}">${t}</button>`).join("")}
    </div>
    <section class="note-list">
      ${list.length ? list.map(noteCard).join("") : `<div class="empty">${filter === "done" ? "아직 완료한 문제가 없어요. 조금만 더 힘내요! 💪" : "기록된 오답이 없어요.<br>틀린 문제를 찍어서 기록해 보세요 📷"}</div>`}
    </section>
    <a class="fab" href="#/new?subject=${key}" style="--sc:${s.color}">📷 ${s.name} 문제 찍기</a>
  `);
  $app.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => renderSubject(key, b.dataset.f));
}

// ---------------------------------------------------------- 새 오답 기록
function renderNew(subject) {
  const d = state.draft && (!subject || state.draft.subject === subject) ? state.draft : { subject: subject || null, image: null, thumb: null, reasons: [], etc: "", memo: "", chapter: "", term: null };
  state.draft = d;
  const reasons = d.subject ? REASONS[d.subject] : [];
  layout(`
    <header class="page-head"><a href="javascript:history.back()" class="back">‹</a><h1>틀린 문제 기록하기</h1></header>

    <section class="card step">
      <h3><span class="num">1</span>과목을 골라요</h3>
      <div class="chip-row">
        ${SUBJECT_KEYS.map((k) => `<button class="subj-pick ${d.subject === k ? "on" : ""}" data-subj="${k}" style="${subjVars(k)}">${SUBJECTS[k].icon} ${SUBJECTS[k].name}</button>`).join("")}
      </div>
    </section>

    <section class="card step ${d.subject ? "" : "disabled"}" id="chapterStep">
      <h3><span class="num">2</span>단원을 골라요 <small class="muted">(2022 개정 교육과정)</small></h3>
      ${d.subject ? `<div id="chapterBox"></div>` : `<p class="muted">과목을 먼저 골라 주세요.</p>`}
    </section>

    <section class="card step">
      <h3><span class="num">3</span>틀린 문제를 찍어요</h3>
      ${d.image ? `<div class="photo-preview"><img src="${d.image}" alt="문제 사진"></div>
        ${d.src ? `<button class="btn full recrop" data-recrop>✂️ 다시 자르기</button>` : ""}`
        : `<div class="photo-empty">📄<p>찍은 뒤에 틀린 문제 하나만 남도록<br>잘라 낼 수 있어요 ✂️</p></div>`}
      <div class="btn-row">
        <label class="btn primary">📷 카메라로 찍기<input type="file" accept="image/*" capture="environment" hidden data-photo></label>
        <label class="btn">🖼️ 앨범에서 고르기<input type="file" accept="image/*" hidden data-photo></label>
      </div>
    </section>

    <section class="card step ${d.subject ? "" : "disabled"}">
      <h3><span class="num">4</span>왜 틀렸을까요? <small class="muted">(여러 개 선택)</small></h3>
      ${d.subject ? `<div class="reason-chips">
        ${reasons.map((r) => `<label class="rchip"><input type="checkbox" value="${esc(r)}" ${d.reasons.includes(r) ? "checked" : ""} data-reason><span>${esc(r)}</span></label>`).join("")}
        <label class="rchip"><input type="checkbox" ${d.etcOn ? "checked" : ""} data-etcon><span>기타</span></label>
      </div>
      ${d.etcOn ? `<input class="etc" placeholder="기타 이유를 짧게 써요" maxlength="30" value="${esc(d.etc)}" data-etc>` : ""}` : `<p class="muted">과목을 먼저 골라 주세요.</p>`}
    </section>

    <section class="card step">
      <h3><span class="num">5</span>메모 <small class="muted">(선택)</small></h3>
      <textarea rows="3" placeholder="내가 쓴 답, 헷갈렸던 부분 등을 적어요" data-memo>${esc(d.memo)}</textarea>
    </section>

    <button class="btn primary big full" id="saveNote">🔥 틀린 문제 정복하기</button>
  `);

  $app.querySelectorAll("[data-subj]").forEach((b) => b.onclick = () => {
    if (d.subject !== b.dataset.subj) { d.subject = b.dataset.subj; d.reasons = []; d.etcOn = false; d.etc = ""; d.chapter = ""; d.term = null; }
    renderNew();
  });
  if (d.subject) mountChapterPicker($app.querySelector("#chapterBox"), d.subject, d);
  $app.querySelectorAll("[data-photo]").forEach((inp) => inp.onchange = async () => {
    const file = inp.files[0]; inp.value = ""; if (!file) return;
    let img;
    try { img = await loadImage(file); } catch { return toast("사진을 불러오지 못했어요."); }
    await cropInto(d, img);
  });
  $app.querySelector("[data-recrop]")?.addEventListener("click", () => cropInto(d, d.src));
  $app.querySelectorAll("[data-reason]").forEach((c) => c.onchange = () => {
    d.reasons = [...$app.querySelectorAll("[data-reason]:checked")].map((x) => x.value);
  });
  $app.querySelector("[data-etcon]")?.addEventListener("change", (e) => {
    d.etcOn = e.target.checked; if (!d.etcOn) d.etc = "";
    const y = window.scrollY; renderNew(); window.scrollTo(0, y);
    if (d.etcOn) $app.querySelector("[data-etc]")?.focus();
  });
  const etc = $app.querySelector("[data-etc]"); if (etc) etc.oninput = () => (d.etc = etc.value);
  $app.querySelector("[data-memo]").oninput = (e) => (d.memo = e.target.value);
  $app.querySelector("#saveNote").onclick = saveDraft;
}

// 자르기 창을 띄우고, 자른 사진을 기록에 넣는다 (취소하면 그대로)
async function cropInto(d, img) {
  const cropped = await openCropper(img);
  if (!cropped) return;
  d.src = img; // 다시 자르기는 원래 사진에서
  loading(true, "사진을 정리하는 중…");
  Object.assign(d, compressPhoto(cropped));
  loading(false); renderNew();
}

async function saveDraft() {
  const d = state.draft;
  if (!d.subject) return toast("과목을 골라 주세요.");
  if (!d.image) return toast("틀린 문제 사진을 찍어 주세요.");
  const reasons = [...d.reasons, ...(d.etc.trim() ? [d.etc.trim()] : [])];
  const base = {
    subject: d.subject, thumb: d.thumb, reasons, memo: d.memo.trim(), status: "learning",
    rounds: 0, totalSolved: 0, totalCorrect: 0, createdAt: Date.now(),
  };
  loading(true, "AI가 문제를 다시 입력하고 동일 유형 문제를 만드는 중… 🔍");
  let note = null, figure = null, aiError = "";
  try {
    const r = await runAnalysis({ image: d.image, subject: d.subject, reasons, memo: d.memo, chapter: d.chapter });
    note = { ...base, ...r.fields }; figure = r.figure;
  } catch (e) {
    console.warn("AI 분석 실패", e);
    aiError = aiErrorMessage(e);
  }
  loading(false);

  // AI를 못 쓰면 사진과 단원만 기록해 두고, 나중에 "AI로 다시 분석"
  if (!note) note = { ...base, source: "none", unit: d.chapter || "", concept: null, bankUnitId: null };
  // 직접 고른 단원이 있으면 그 단원으로 분류
  if (d.chapter) { note.chapter = d.chapter; note.term = d.term || null; }

  loading(true, "오답노트에 저장하는 중…");
  try {
    if (d.chapter && !d.term) await rememberChapter(d.subject, d.chapter);
    const id = await DB.createNote(state.uid, note, d.image);
    if (figure) await DB.saveFigure(state.uid, id, figure);
    state.notes.unshift({ id, ...note });
    state.draft = null;
    loading(false);
    if (aiError) toast(`📒 기록했어요. ${aiError} 나중에 "🤖 AI로 분석하기"를 눌러 주세요.`, 6000);
    else toast("📒 기록했어요. AI가 옮겨 쓴 문제는 맞춤형 문제에도 저장됐어요.", 3500);
    go(`#/note/${id}`);
  } catch (e) {
    loading(false);
    toast("저장하지 못했어요: " + (e.message || e));
  }
}

// 문제은행 단원 선택 창. 고른 단원 / null(단원 없이) / undefined(취소)
function pickBankUnit(subject, message, allowNone = false) {
  return new Promise((resolve) => {
    const band = bandOf(state.profile?.grade);
    const units = unitsFor(subject, state.custom).sort((a, b) => (a.band === band ? -1 : 0) - (b.band === band ? -1 : 0));
    let decided = false;
    const m = modal(`
      <h3>단원 고르기</h3>
      <p class="muted center">${message}</p>
      <div class="unit-list">
        ${units.map((u) => `<button class="unit-item" data-u="${u.id}"><span class="band ${u.band}">${BANDS[u.band]}</span>${esc(u.title)}${u.custom ? ' <small class="muted">(추가)</small>' : ""}</button>`).join("")}
      </div>
      <div class="btn-row">
        ${allowNone ? `<button class="btn" data-none>단원 없이 기록만 저장</button>` : ""}
        <button class="btn ghost" data-close>취소</button>
      </div>`, (el) => {
      el.querySelectorAll("[data-u]").forEach((b) => b.onclick = () => { decided = true; el.remove(); resolve(findUnit(b.dataset.u, state.custom)); });
      el.querySelector("[data-none]")?.addEventListener("click", () => { decided = true; el.remove(); resolve(null); });
    });
    new MutationObserver((_, obs) => { if (!document.body.contains(m)) { obs.disconnect(); if (!decided) resolve(undefined); } })
      .observe(document.body, { childList: true });
  });
}

// ---------------------------------------------------------- 오답 상세
// AI가 옮겨 쓴 문제를 문서처럼 보여 준다
function docHtml(o, figure = false) {
  return `<p class="doc-q">${esc(o.question)}</p>
    ${figure ? `<div class="doc-fig" id="figBox"><div class="spinner small"></div></div>` : ""}
    ${isMulti(o) ? partsHtml(o) : ""}
    ${typeOf(o) === "choice" ? `<ol class="doc-choices">${o.choices.map((c, i) => `<li><span>${"①②③④⑤"[i]}</span>${esc(c)}</li>`).join("")}</ol>` : ""}
    ${o.hasFigure && !figure ? `<p class="warn small">그림이 있는 문제예요. 그림은 아래 원본 사진에서 확인해요.</p>` : ""}`;
}

async function renderNote(id) {
  const n = noteById(id);
  if (!n) return go("#/home");
  const s = SUBJECTS[n.subject];
  const c = n.concept;
  layout(`
    <header class="subject-head" style="${subjVars(n.subject)}">
      <a href="#/subject/${n.subject}" class="back">‹</a>
      <span class="s-icon">${s.icon}</span>
      <div><small>${s.name} · ${fmtDate(n.createdAt)}${n.chapter && n.chapter !== n.unit ? ` · ${esc(chapterOf(n))}` : ""}</small><h1>${esc(n.unit || "단원 미정")}</h1></div>
    </header>
    <div class="status-row">${statusBadge(n)}${n.rounds ? `<span class="muted">연습 ${n.rounds}회 · 정답률 ${Math.round((n.totalCorrect / Math.max(1, n.totalSolved)) * 100)}%</span>` : ""}</div>

    ${n.original ? `<section class="card doc">
      <h3>📄 다시 입력한 문제 <small class="muted">채점 표시 없이 · 맞춤형 문제에 저장됨</small><span class="h3-tools"><button class="btn small" id="reAI2">🔄 다시 분석</button><button class="btn small" id="editDoc">✏️ 고치기</button></span></h3>
      ${docHtml(n.original, n.hasFigureImg)}
      <details class="fold"><summary>정답과 풀이 보기</summary><p class="pre">${esc(correctAnswerOf(n.original))}</p></details>
      <details class="fold" id="origFold"><summary>📸 원본 사진 보기</summary><div class="photo-preview" id="photo"><img src="${n.thumb}" alt="문제 사진" class="blur"></div></details>
    </section>` : `<section class="card">
      <h3>📸 틀린 문제</h3>
      <div class="photo-preview" id="photo"><img src="${n.thumb}" alt="문제 사진" class="blur"></div>
      <p class="warn">아직 AI가 이 문제를 문서로 옮기지 못했어요. AI로 분석하면 채점 표시 없이 다시 입력되고, 맞춤형 문제에 저장돼요.</p>
      <button class="btn primary full" id="reAI">🤖 AI로 분석하기</button>
    </section>`}

    <section class="card">
      <h3>🤔 내가 틀린 이유</h3>
      ${n.reasons?.length ? `<div class="chip-row">${n.reasons.map((r) => `<span class="reason-chip">${esc(r)}</span>`).join("")}</div>` : `<p class="muted">선택한 이유가 없어요.</p>`}
      ${n.memo ? `<p class="memo">📝 ${esc(n.memo)}</p>` : ""}
    </section>

    ${c ? `<section class="card concept" style="${subjVars(n.subject)}">
      <h3>💡 핵심 개념</h3>
      <h4>${esc(c.title)}</h4>
      <p>${esc(c.summary)}</p>
      ${c.points?.length ? `<ul>${c.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : ""}
      ${c.tip ? `<div class="tip"><b>TIP</b> ${esc(c.tip)}</div>` : ""}
    </section>` : `<section class="card">
      <h3>💡 핵심 개념</h3>
      <p class="muted">아직 개념 정리가 없어요. 위의 🤖 AI로 분석하기를 눌러 주세요.</p>
    </section>`}

    <button class="btn primary big full" id="practice">${n.status === "done" ? "🔁 동일 유형 문제 연습" : "✏️ 동일 유형 문제 풀기"}</button>
    <div class="btn-row sub">
      <button class="btn" id="chChapter">📂 단원 바꾸기</button>
      <button class="btn" id="pickUnit">📚 문제은행 단원 ${n.bankUnitId ? "바꾸기" : "연결"}</button>
      <button class="btn danger ghost" id="del">🗑️ 삭제</button>
    </div>
  `);

  const showPhoto = () => DB.getImage(state.uid, id).then((img) => {
    const box = $app.querySelector("#photo");
    if (img && box) { box.innerHTML = `<img src="${img}" alt="문제 사진">`; box.onclick = () => modal(`<img class="full-img" src="${img}" alt=""><button class="btn full" data-close>닫기</button>`); }
  });
  const fold = $app.querySelector("#origFold");
  if (fold) fold.addEventListener("toggle", () => fold.open && showPhoto(), { once: true }); else showPhoto();
  if (n.hasFigureImg) DB.getFigure(state.uid, id).then((img) => { const b = $app.querySelector("#figBox"); if (b) b.innerHTML = img ? `<img src="${img}" alt="그림">` : ""; });
  $app.querySelector("#editDoc")?.addEventListener("click", () => editDocument(n));

  $app.querySelector("#chChapter").onclick = () => {
    const sel = { term: n.term || null, chapter: n.chapter || "" };
    modal(`<h3>📂 단원 바꾸기</h3><p class="muted center small">맞춤형 문제는 이 단원으로 묶여요.</p><div id="chBox"></div>
      <div class="btn-row"><button class="btn primary" data-save>저장</button><button class="btn ghost" data-close>취소</button></div>`, (el) => {
      mountChapterPicker(el.querySelector("#chBox"), n.subject, sel);
      el.querySelector("[data-save]").onclick = async () => {
        el.remove();
        // 선택을 취소하면 AI가 정한 단원으로 되돌린다
        const patch = sel.chapter ? { chapter: sel.chapter, term: sel.term || null } : { chapter: n.aiChapter || n.unit || "", term: null };
        if (sel.chapter && !sel.term) await rememberChapter(n.subject, sel.chapter);
        await DB.updateNote(state.uid, id, patch); Object.assign(n, patch);
        toast("단원을 바꿨어요."); renderNote(id);
      };
    });
  };
  $app.querySelector("#practice").onclick = () => {
    state.practice = null;
    go(`#/practice/${id}`);
  };
  $app.querySelector("#pickUnit").onclick = async () => {
    const u = await pickBankUnit(n.subject, "연습에 사용할 문제은행 단원을 골라요.");
    if (!u) return;
    const patch = { bankUnitId: u.id, ...(n.source !== "ai" ? { source: "bank", unit: u.title, chapter: u.title, concept: u.concept } : {}) };
    await DB.updateNote(state.uid, id, patch); Object.assign(n, patch);
    toast("단원을 연결했어요."); renderNote(id);
  };
  // 분석이 끝났을 때 아직 이 문제 화면이면 새로 그린다
  const redraw = () => { if (location.hash === `#/note/${id}`) renderNote(id); };
  $app.querySelector("#reAI")?.addEventListener("click", async () => { await reanalyze(n); redraw(); });
  $app.querySelector("#reAI2")?.addEventListener("click", async () => {
    if (!(await confirmBox("이 문제를 다시 분석할까요?", "AI가 사진을 다시 읽어 문제·정답·동일 유형 문제를 새로 만들어요.<br>✏️ 고치기로 바꾼 내용은 새 분석으로 바뀌어요.", "다시 분석"))) return;
    await reanalyze(n); redraw();
  });
  $app.querySelector("#del").onclick = async () => {
    if (!(await confirmBox("이 오답 기록을 삭제할까요?", "삭제하면 되돌릴 수 없어요.", "삭제", true))) return;
    loading(true, "삭제하는 중…");
    try { await DB.deleteNote(state.uid, id); state.notes = state.notes.filter((x) => x.id !== id); go(`#/subject/${n.subject}`); }
    catch (e) { toast("삭제하지 못했어요."); }
    loading(false);
  };
}

// 저장된 사진을 AI로 다시 분석 (성공하면 true)
async function reanalyze(n) {
  const img = await DB.getImage(state.uid, n.id);
  if (!img) { toast("사진을 불러오지 못했어요."); return false; }
  loading(true, "AI가 문제를 다시 입력하고 동일 유형 문제를 만드는 중… 🔍");
  try {
    const r = await runAnalysis({ image: img, subject: n.subject, reasons: n.reasons || [], memo: n.memo, chapter: n.chapter });
    const patch = { ...r.fields, bankUnitId: n.bankUnitId || r.fields.bankUnitId };
    if (n.term || (n.chapter && n.chapter !== n.aiChapter && n.chapter !== n.unit)) patch.chapter = n.chapter;
    if (r.figure) await DB.saveFigure(state.uid, n.id, r.figure);
    await DB.updateNote(state.uid, n.id, patch); Object.assign(n, patch);
    forgetImage(n.id);
    loading(false); toast("분석을 마쳤어요 ✨ 맞춤형 문제에도 저장됐어요.");
    return true;
  } catch (e) {
    console.warn(e);
    loading(false);
    toast(aiErrorMessage(e), 6000);
    return false;
  }
}

// AI가 잘못 읽은 글자를 직접 고친다 (여러 문항이면 소문항마다)
function answerFields(q, prefix) {
  const t = typeOf(q);
  return t === "choice"
    ? `<label>보기 (한 줄에 하나씩)<textarea name="${prefix}choices" rows="${Math.min(5, q.choices.length)}">${esc(q.choices.join("\n"))}</textarea></label>
       <label>정답 번호<input name="${prefix}answer" type="number" min="1" max="5" value="${q.answer + 1}"></label>`
    : `<label>${t === "essay" ? "모범 답안" : "정답"}<input name="${prefix}answer" value="${esc(q.answer)}"></label>`;
}
function readFields(q, f, prefix) {
  const t = typeOf(q), ans = String(f[prefix + "answer"] ?? "").trim();
  return t === "choice"
    ? { type: t, choices: String(f[prefix + "choices"]).split("\n").map((x) => x.trim()).filter(Boolean), answer: Number(ans) - 1 }
    : { type: t, answer: ans, accept: t === "short" && ans === String(q.answer) ? q.accept : [] };
}

function editDocument(n) {
  const o = n.original, multi = isMulti(o);
  modal(`<h3>✏️ 문제 고치기</h3>
    <form class="form" id="docForm">
      <p class="muted small">수식은 $ 사이에 써요. 예: 분수 $\\frac{1}{2}$ → <code>$\\frac{1}{2}$</code>, 대분수 <code>$2\\frac{1}{3}$</code></p>
      <label>${multi ? "공통 지문·조건" : "문제"}<textarea name="question" rows="5">${esc(o.question)}</textarea></label>
      ${multi ? o.parts.map((q, i) => `<fieldset class="part-edit"><legend>${esc(q.label)}</legend>
          <label>소문항<textarea name="p${i}question" rows="2">${esc(q.question)}</textarea></label>
          ${answerFields(q, `p${i}`)}
        </fieldset>`).join("") : answerFields(o, "")}
      <label>풀이<textarea name="explanation" rows="3">${esc(o.explanation || "")}</textarea></label>
      <p class="error" id="docErr"></p>
      <div class="btn-row"><button class="btn primary" type="submit">저장</button><button class="btn ghost" type="button" data-close>취소</button></div>
    </form>`, (el) => {
    el.querySelector("#docForm").onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const base = { question: f.question.trim(), explanation: f.explanation.trim() };
      const fixed = cleanProblem(multi
        ? { ...base, type: "multi", parts: o.parts.map((q, i) => ({ label: q.label, question: String(f[`p${i}question`]).trim(), explanation: q.explanation, ...readFields(q, f, `p${i}`) })) }
        : { ...base, ...readFields(o, f, "") });
      if (!fixed) { el.querySelector("#docErr").textContent = "문제, 보기(2~5개), 정답을 확인해 주세요."; return; }
      Object.assign(fixed, { hasFigure: o.hasFigure, figureBox: o.figureBox || null });
      const patch = { original: fixed, problemText: problemTextOf(fixed), correctAnswer: correctAnswerOf(fixed) };
      await DB.updateNote(state.uid, n.id, patch); Object.assign(n, patch);
      el.remove(); toast("고쳤어요."); renderNote(n.id);
    };
  }, "wide");
}

// ---------------------------------------------------------- 동일 유형 문제 풀기
// 1라운드는 처음 분석 때 만든 문제, 그다음은 AI가 원래 문제의 숫자·보기만 바꿔 새로 만든다
async function nextSet(n, p) {
  if (p.round === 1 && n.firstSet?.length) return { problems: n.firstSet, from: "ai" };
  if (!n.original) return { error: "아직 AI가 이 문제를 분석하지 못해서 동일 유형 문제를 만들 수 없어요." };
  try {
    return { problems: await moreProblems({ note: n, grade: state.profile?.grade, seen: p.seen, wrongCount: p.lastWrong }), from: "ai" };
  } catch (e) { console.warn("AI 추가 문제 실패", e); return { error: aiErrorMessage(e) }; }
}

// 동일 유형 문제를 못 만들었을 때: 다시 시도 / AI 분석 / (동일 유형이 아닌) 문제은행 중에서 직접 고른다
function fallbackChoice(n, reason) {
  return new Promise((resolve) => {
    let picked = null;
    const m = modal(`<h3>동일 유형 문제를 만들지 못했어요</h3>
      <p class="muted center">${esc(reason)}</p>
      <div class="btn-col">
        ${n.original ? `<button class="btn primary" data-pick="retry">🔄 다시 시도</button>` : `<button class="btn primary" data-pick="ai">🤖 AI로 분석하기</button>`}
        <button class="btn" data-pick="bank">📚 문제은행 기본 문제로 연습 <small class="muted">(동일 유형 아님)</small></button>
        <button class="btn ghost" data-close>닫기</button>
      </div>`, (el) => el.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => { picked = b.dataset.pick; el.remove(); }));
    new MutationObserver((_, obs) => { if (!document.body.contains(m)) { obs.disconnect(); resolve(picked); } }).observe(document.body, { childList: true });
  });
}

async function getSet(n, p) {
  for (;;) {
    loading(true, p.round === 1 ? "문제를 준비하는 중… ✏️" : "숫자를 바꾼 새 문제를 만드는 중… ✏️");
    const r = await nextSet(n, p);
    loading(false);
    if (r.problems) return r;
    const pick = await fallbackChoice(n, r.error);
    if (pick === "bank") return askBankSet(n, p.seen);
    if (pick === "ai") await reanalyze(n);
    if (!pick) return null;
  }
}

async function askBankSet(n, seen) {
  const u = await pickBankUnit(n.subject, "AI 없이 문제은행의 기본 문제로 연습해요.<br>비슷한 단원을 골라 주세요. (원래 문제와 같은 유형은 아니에요)");
  if (!u) return null;
  await DB.updateNote(state.uid, n.id, { bankUnitId: u.id }); n.bankUnitId = u.id;
  return { problems: drawProblems(u, 3, seen), from: "bank" };
}

const resetQ = (p) => Object.assign(p, { a: {}, checked: false, self: false });

async function renderPractice(id) {
  const n = noteById(id);
  if (!n) return go("#/home");
  let p = state.practice;
  if (!p || p.noteId !== id) {
    p = state.practice = { noteId: id, round: 1, problems: [], idx: 0, results: [], seen: [], lastWrong: 0, a: {}, checked: false };
    const set = await getSet(n, p);
    if (!set) { state.practice = null; return go(`#/note/${id}`); }
    p.problems = set.problems; p.from = set.from;
    p.seen.push(...p.problems.map((x) => x.question));
  }
  if (p.idx >= p.problems.length) return renderRoundResult(n, p);

  const s = SUBJECTS[n.subject];
  const q = p.problems[p.idx];
  const t = typeOf(q);
  const r = p.results[p.idx];
  const needSelf = p.checked && r == null && (t === "essay" || isMulti(q));
  layout(`
    <header class="subject-head" style="${subjVars(n.subject)}">
      <a href="#/note/${id}" class="back">‹</a>
      <span class="s-icon">${s.icon}</span>
      <div><small>${esc(n.unit || s.name)}</small><h1>${p.from === "bank" ? "📚 문제은행 기본 문제" : "동일 유형 문제"} ${p.round > 1 ? `· 추가 ${p.round - 1}회차` : ""}</h1></div>
    </header>
    <div class="progress">
      ${p.problems.map((_, i) => `<span class="dot ${i < p.idx ? (p.results[i] ? "ok" : "no") : i === p.idx ? "now" : ""}"></span>`).join("")}
      <small class="muted">${p.idx + 1} / ${p.problems.length}</small>
      ${p.from === "bank" ? `<small class="muted">· 문제은행</small>` : ""}
    </div>
    <section class="card question" style="${subjVars(n.subject)}">
      <p class="q-text">${esc(q.question)}</p>
      ${answerInput(q, p.a, { checked: p.checked, partResults: p.checked && isMulti(q) ? gradeParts(q, p.a) : null })}
      ${p.checked ? `<div class="feedback ${r === true ? "ok" : r === false ? "no" : "neutral"}">
        <b>${isMulti(q)
          ? (r === true ? "모두 맞혔어요! 🎉" : r === false ? `아쉬워요! ${q.parts.length}문항 중 ${gradeParts(q, p.a).filter((x) => x === true).length}개 맞았어요.` : "서술형 소문항은 모범 답안과 비교해 보세요.")
          : r === true ? "정답이에요! 🎉" : r === false ? `아쉬워요! 정답은 ${esc(answerText(q))} 이에요.` : `모범 답안: ${esc(answerText(q))}`}</b>
        <p>${esc(q.explanation)}</p>
        ${t === "essay" || (isMulti(q) && (r == null || p.self)) ? `<div class="self-check"><span>내 답과 비교해 보세요</span>
          <button class="ok ${r === true ? "on" : ""}" data-self="1">○ 맞았어요</button>
          <button class="no ${r === false ? "on" : ""}" data-self="0">✕ 틀렸어요</button></div>` : ""}
      </div>` : ""}
    </section>
    <button class="btn primary big full" id="act" ${(!p.checked && !hasAnswer(q, p.a)) || needSelf ? "disabled" : ""}>
      ${!p.checked ? "정답 확인" : p.idx + 1 < p.problems.length ? "다음 문제 ›" : "결과 보기"}
    </button>
  `);
  const act = $app.querySelector("#act");
  if (!p.checked) {
    // 객관식을 고르거나 답을 쓰면 버튼만 켠다 (다시 그리지 않아 입력 중인 칸이 그대로)
    bindAnswers($app, () => p.a, {
      getP: () => q,
      onChange: () => { act.disabled = !hasAnswer(q, p.a); },
      onSubmit: () => { if (hasAnswer(q, p.a)) act.click(); else toast("아직 비어 있는 칸이 있어요."); },
    });
    $app.querySelector("[data-text]")?.focus();
  }
  $app.querySelectorAll("[data-self]").forEach((b) => b.onclick = () => { p.results[p.idx] = b.dataset.self === "1"; p.self = true; renderPractice(id); });
  act.onclick = () => {
    if (!p.checked) { p.checked = true; p.results[p.idx] = autoGrade(q, p.a); }
    else { p.idx++; resetQ(p); }
    renderPractice(id);
  };
}

async function renderRoundResult(n, p) {
  const correct = p.results.filter(Boolean).length;
  const total = p.problems.length;
  const perfect = correct === total;

  if (!p.saved) {
    p.saved = true;
    const patch = { rounds: (n.rounds || 0) + 1, totalSolved: (n.totalSolved || 0) + total, totalCorrect: (n.totalCorrect || 0) + correct };
    if (perfect && n.status !== "done") Object.assign(patch, { status: "done", doneAt: Date.now() });
    Object.assign(n, patch);
    DB.updateNote(state.uid, n.id, patch).catch((e) => toast("기록 저장 실패: " + e.message));
    p.message = perfect ? pick(PRAISE) : pick(ENCOURAGE);
  }

  layout(`
    <section class="card result ${perfect ? "perfect" : ""}" style="${subjVars(n.subject)}">
      <div class="big-emoji">${perfect ? "🏆" : "🌱"}</div>
      <h2>${total}문제 중 ${correct}문제 정답!</h2>
      <p class="msg">${esc(p.message)}</p>
      <div class="progress center">${p.results.map((r) => `<span class="dot ${r ? "ok" : "no"}"></span>`).join("")}</div>
      ${perfect ? `<p class="muted">이 오답은 <b>학습 완료</b>로 옮겨졌어요.</p>`
        : `<p class="muted">숫자만 바꾼 동일 유형 문제로 한 번 더 도전해요.<br>모두 맞히면 학습 완료예요!</p>`}
    </section>
    ${!perfect ? `<section class="card">
      <h3>📌 틀린 문제 다시 보기</h3>
      ${p.problems.map((q, i) => p.results[i] ? "" : `<div class="review"><p>${esc(q.question)}</p>${isMulti(q) ? partsHtml(q) : ""}<p class="ans">정답: ${esc(answerText(q))}</p><p class="muted">${esc(q.explanation)}</p></div>`).join("")}
    </section>` : ""}
    ${perfect ? `<button class="btn primary big full" id="home">🏠 홈으로</button>` : `<button class="btn primary big full" id="more">💪 동일 유형 문제 더 풀기</button>`}
    <a class="btn full" href="#/note/${n.id}">오답노트로 돌아가기</a>
  `);
  $app.querySelector("#home")?.addEventListener("click", () => { state.practice = null; go("#/home"); });
  $app.querySelector("#more")?.addEventListener("click", async () => {
    p.lastWrong = total - correct;
    p.round++;
    const bankUnit = p.from === "bank" && findUnit(n.bankUnitId, state.custom);
    const set = bankUnit ? { problems: drawProblems(bankUnit, 3, p.seen), from: "bank" } : await getSet(n, p);
    if (!set) { p.round--; return; }
    Object.assign(p, { problems: set.problems, from: set.from, idx: 0, results: [], saved: false });
    resetQ(p);
    p.seen.push(...p.problems.map((x) => x.question));
    renderPractice(n.id);
  });
}

// ---------------------------------------------------------- 설정
function renderSettings() {
  const p = state.profile || {};
  layout(`
    <header class="page-head"><h1>설정</h1></header>
    <section class="card">
      <h3>👤 내 정보</h3>
      <form id="profile" class="form">
        <label>아이디<input value="${esc(p.loginId)}" disabled></label>
        <label>이름(별명)<input name="name" value="${esc(p.name)}" maxlength="12" required></label>
        <label>학년<select name="grade">${GRADES.map((g) => `<option ${g === p.grade ? "selected" : ""}>${g}</option>`).join("")}</select></label>
        <button class="btn primary" type="submit">저장</button>
      </form>
      <p class="muted small">학년에 맞춰 AI가 개념 설명과 문제 난이도를 조절해요.</p>
    </section>
    <section class="card">
      <h3>📚 문제은행</h3>
      <p class="muted">AI를 쓸 수 없을 때 사용하는 문제예요. 기본 단원 외에 직접 단원을 추가할 수 있어요. (가족 공용)</p>
      <a class="btn" href="#/bank">문제은행 관리하기 ›</a>
    </section>
    <section class="card">
      <button class="btn danger ghost full" id="logout">로그아웃</button>
    </section>
  `, "settings");
  $app.querySelector("#profile").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const data = { name: f.name.trim(), grade: f.grade };
    await DB.saveProfile(state.uid, data); Object.assign(state.profile, data);
    toast("저장했어요.");
  };
  $app.querySelector("#logout").onclick = () => DB.logout();
}

// ---------------------------------------------------------- 문제은행 관리
const BANK_EXAMPLE = `Q: 3 + 4 × 2 의 값은?
1) 14
2) 11
3) 10
4) 9
정답: 2
해설: 곱셈을 먼저 계산해요. 4 × 2 = 8, 3 + 8 = 11

Q: 다음 문제…
1) …
2) …
3) …
4) …
정답: 1
해설: …`;

function parseProblems(text) {
  const out = [], errors = [];
  text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean).forEach((block, bi) => {
    const lines = block.split("\n").map((l) => l.trim());
    const q = lines.find((l) => /^Q[:.]/i.test(l))?.replace(/^Q[:.]\s*/i, "");
    const c = lines.filter((l) => /^[1-4][).]/.test(l)).map((l) => l.replace(/^[1-4][).]\s*/, ""));
    const a = parseInt(lines.find((l) => l.startsWith("정답"))?.replace(/\D/g, ""), 10) - 1;
    const e = lines.find((l) => l.startsWith("해설"))?.replace(/^해설[:.]?\s*/, "") || "";
    if (!q || c.length !== 4 || !(a >= 0 && a < 4)) errors.push(bi + 1);
    else out.push({ q, c, a, e });
  });
  return { out, errors };
}

function renderBank() {
  layout(`
    <header class="page-head"><a href="#/settings" class="back">‹</a><h1>문제은행 관리</h1></header>
    <section class="card">
      <h3>추가한 단원</h3>
      ${state.custom.length ? `<div class="unit-list">${state.custom.map((u) => `
        <div class="unit-item static">${subjChip(u.subject)} <span class="band ${u.band}">${BANDS[u.band]}</span> ${esc(u.title)} <small class="muted">${u.p?.length || 0}문제</small>
        <button class="btn small danger ghost" data-del="${u.id}">삭제</button></div>`).join("")}</div>`
        : `<p class="muted">아직 추가한 단원이 없어요. 기본 단원 ${SUBJECT_KEYS.reduce((s, k) => s + unitsFor(k).length, 0)}개가 들어 있어요.</p>`}
    </section>
    <section class="card">
      <h3>➕ 새 단원 추가</h3>
      <form id="bankForm" class="form">
        <div class="grid2">
          <label>과목<select name="subject">${SUBJECT_KEYS.map((k) => `<option value="${k}">${SUBJECTS[k].name}</option>`).join("")}</select></label>
          <label>학교급<select name="band">${Object.entries(BANDS).map(([k, v]) => `<option value="${k}" ${k === bandOf(state.profile?.grade) ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        </div>
        <label>단원 이름<input name="title" required placeholder="예: 소인수분해"></label>
        <label>핵심 개념 제목<input name="ctitle" required placeholder="예: 소수의 곱으로 나타내기"></label>
        <label>개념 설명<textarea name="summary" rows="2" required></textarea></label>
        <label>꼭 알아야 할 원리 (한 줄에 하나씩)<textarea name="points" rows="3"></textarea></label>
        <label>TIP<input name="tip"></label>
        <label>문제 (빈 줄로 구분, 최소 3문제)<textarea name="problems" rows="12" placeholder="${esc(BANK_EXAMPLE)}"></textarea></label>
        <p class="error" id="bankErr"></p>
        <button class="btn primary" type="submit">단원 저장</button>
      </form>
    </section>
  `, "settings");
  $app.querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!(await confirmBox("이 단원을 삭제할까요?", "문제은행에서 사라져요.", "삭제", true))) return;
    await DB.deleteCustomUnit(b.dataset.del);
    state.custom = state.custom.filter((u) => u.id !== b.dataset.del);
    renderBank();
  });
  $app.querySelector("#bankForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $app.querySelector("#bankErr");
    const { out, errors } = parseProblems(f.problems);
    if (errors.length) { err.textContent = `${errors.join(", ")}번째 문제의 형식을 확인해 주세요. (Q:, 보기 1)~4), 정답:)`; return; }
    if (out.length < 3) { err.textContent = "문제를 3개 이상 넣어 주세요."; return; }
    const unit = {
      subject: f.subject, band: f.band, title: f.title.trim(),
      concept: { title: f.ctitle.trim(), summary: f.summary.trim(), points: f.points.split("\n").map((s) => s.trim()).filter(Boolean), tip: f.tip.trim() },
      p: out, createdBy: state.uid, createdAt: Date.now(),
    };
    loading(true, "저장하는 중…");
    try { const id = await DB.saveCustomUnit(unit); state.custom.push({ id, custom: true, ...unit }); toast("단원을 추가했어요."); renderBank(); }
    catch (ex) { err.textContent = "저장하지 못했어요: " + ex.message; }
    loading(false);
  };
}

// ---------------------------------------------------------- 시작
if (DB.isConfigured) {
  initAI(DB.app);
  DB.watchAuth(async (user) => {
    if (!user) { Object.assign(state, { uid: null, profile: null, notes: [], exams: [], practice: null, draft: null, exam: null }); return render(); }
    state.uid = user.uid;
    loading(true, "오답노트를 불러오는 중…");
    try {
      // 회원가입 직후에는 프로필 저장이 조금 늦을 수 있어 한 번 더 확인
      state.profile = await DB.getProfile(user.uid);
      if (!state.profile) { await new Promise((r) => setTimeout(r, 800)); state.profile = (await DB.getProfile(user.uid)) || { name: "학생", grade: "중1" }; }
      [state.notes, state.custom, state.exams] = await Promise.all([DB.listNotes(user.uid), DB.listCustomUnits(), DB.listExams(user.uid).catch(() => [])]);
    } catch (e) { console.error(e); toast("불러오기 실패: Firestore 설정을 확인해 주세요."); }
    loading(false);
    render();
  });
} else {
  render();
}
