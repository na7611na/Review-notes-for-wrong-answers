// ============================================================
//  맞춤형 문제: 틀린 문제를 과목·단원별로 모아 새 시험지처럼 다시 풀기
//  - 화면에서 풀면 바로 채점, 인쇄하면 문제지 + 정답·해설지
//  - 종이에 푼 뒤에는 "종이 답 채점하기"에서 ○/✕만 체크
// ============================================================
import { SUBJECTS, SUBJECT_KEYS } from "./data.js";
import * as DB from "./db.js";
import { $app, state, esc, go, fmtDate, toast, loading, layout, subjChip, subjVars, noteById, confirmBox } from "./ui.js";
import { NUM, TYPE_LABEL, typeOf, answerInput, answerText, autoGrade, hasAnswer } from "./answer.js";

export const chapterOf = (n) => (n.chapter || n.unit || "단원 미정").trim();

// ---------------------------------------------------------- 시험지 문항 만들기
const imgCache = new Map();
async function cachedImage(key, fetcher) {
  if (!imgCache.has(key)) imgCache.set(key, await fetcher().catch(() => null));
  return imgCache.get(key);
}
export const forgetImage = (noteId) => { imgCache.delete(noteId); imgCache.delete(noteId + "-clean"); };

// 문항 표시 방법: 지운 사진 > (그림 없으면) AI가 옮겨 쓴 글 > 원본 사진(채점 표시가 남아 있음)
async function buildItems(exam) {
  const notes = exam.noteIds.map(noteById).filter(Boolean);
  return Promise.all(notes.map(async (n) => {
    const o = n.original || null;
    let image = await cachedImage(n.id + "-clean", () => DB.getCleanImage(state.uid, n.id));
    let marked = false;
    if (!image && (!o || o.hasFigure)) { image = await cachedImage(n.id, () => DB.getImage(state.uid, n.id)); marked = true; }
    return { n, o, image, marked };
  }));
}
// 사진으로 내는 객관식은 보기 글 없이 번호만 고르게 한다
const inputOpts = (it, extra = {}) => ({ ...extra, key: it.n.id, numbersOnly: !!it.image && typeOf(it.o) === "choice", count: it.o?.choices?.length || 5 });
const gradeTarget = (it) => it.o || { type: "short", answer: "" };

function questionHtml(it) {
  if (it.image) return `<img class="ei-img" src="${it.image}" alt="문제">`;
  return `<p class="q-text">${esc(it.o.question)}</p>`;
}

// ---------------------------------------------------------- 목록
export function renderExams() {
  layout(`
    <header class="page-head"><h1>📝 맞춤형 문제</h1></header>
    <p class="muted intro">틀린 문제를 과목·단원별로 모아 <b>새 시험지</b>처럼 다시 풀어요. 화면에서 풀거나 인쇄해서 종이에 풀 수 있어요.</p>
    <a class="cta soft" href="#/exam-new">
      <span class="cta-icon">✨</span>
      <span><b>새 시험지 만들기</b><small>과목과 단원을 고르면 자동으로 만들어져요</small></span>
      <span class="arrow">›</span>
    </a>
    <h2 class="sec-title">내 시험지</h2>
    <section class="note-list">
      ${state.exams.length ? state.exams.map((e) => `
        <a class="exam-card" href="#/exam/${e.id}" style="${subjVars(e.subject)}">
          <span class="s-icon">${SUBJECTS[e.subject].icon}</span>
          <div class="nc-body">
            <b class="nc-title">${esc(e.title)}</b>
            <small class="muted">${fmtDate(e.createdAt)} · ${e.noteIds.length}문제</small>
          </div>
          ${e.status === "graded" ? `<span class="score-badge">${e.score}/${e.total}</span>` : `<span class="badge learning">풀기 전</span>`}
        </a>`).join("") : `<div class="empty">아직 만든 시험지가 없어요.<br>틀린 문제가 모이면 시험지를 만들어 보세요 📝</div>`}
    </section>
  `, "exams");
}

// ---------------------------------------------------------- 만들기
export function renderExamNew(opts = {}) {
  const withSubject = SUBJECT_KEYS.filter((k) => state.notes.some((n) => n.subject === k));
  const subject = opts.subject || withSubject[0] || "math";
  const includeDone = !!opts.includeDone;
  const pool = state.notes.filter((n) => n.subject === subject && (includeDone || n.status !== "done"));
  const groups = {};
  pool.forEach((n) => (groups[chapterOf(n)] ||= []).push(n));
  const chapters = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
  const picked = opts.picked || new Set(chapters);
  const chosen = chapters.filter((c) => picked.has(c)).flatMap((c) => groups[c]);
  const noAI = chosen.filter((n) => !n.original).length;
  const figure = chosen.filter((n) => n.original?.hasFigure && !n.hasClean).length;

  layout(`
    <header class="page-head"><a href="#/exams" class="back">‹</a><h1>새 시험지 만들기</h1></header>
    <section class="card step">
      <h3><span class="num">1</span>과목</h3>
      <div class="chip-row">
        ${SUBJECT_KEYS.map((k) => `<button class="subj-pick ${subject === k ? "on" : ""}" data-subj="${k}" style="${subjVars(k)}">${SUBJECTS[k].icon} ${SUBJECTS[k].name} <small>${state.notes.filter((n) => n.subject === k).length}</small></button>`).join("")}
      </div>
    </section>
    <section class="card step">
      <h3><span class="num">2</span>단원 <small class="muted">(단원별로 자동 분류했어요)</small></h3>
      <div class="seg wide">
        <button class="${includeDone ? "" : "on"}" data-done="0">학습 중인 문제만</button>
        <button class="${includeDone ? "on" : ""}" data-done="1">완료한 문제도 포함</button>
      </div>
      ${chapters.length ? `<div class="check-list">
        ${chapters.map((c) => `<label class="check"><input type="checkbox" data-ch="${esc(c)}" ${picked.has(c) ? "checked" : ""}><span>${esc(c)} <small class="muted">${groups[c].length}문제</small></span></label>`).join("")}
      </div>` : `<p class="muted">이 과목에 ${includeDone ? "" : "학습 중인 "}오답이 없어요.</p>`}
    </section>
    <section class="card step">
      <h3><span class="num">3</span>시험지 이름</h3>
      <input id="examTitle" value="${esc(opts.title ?? `${SUBJECTS[subject].name} 맞춤형 문제 (${fmtDate(Date.now())})`)}">
      ${noAI ? `<p class="warn">ℹ️ AI 분석이 안 된 문제 ${noAI}개는 자동 채점이 안 돼서, 풀고 나서 직접 ○/✕를 체크해요.</p>` : ""}
      ${figure ? `<p class="warn">🧽 그림이 있는 문제 ${figure}개는 사진으로 나와요. 오답노트에서 <b>채점 표시 지우기</b>를 하면 깨끗하게 나와요.</p>` : ""}
    </section>
    <button class="btn primary big full" id="make" ${chosen.length ? "" : "disabled"}>📝 ${chosen.length}문제로 시험지 만들기</button>
  `, "exams");

  const rerender = (patch) => renderExamNew({ subject, includeDone, picked, title: $app.querySelector("#examTitle").value, ...patch });
  $app.querySelectorAll("[data-subj]").forEach((b) => b.onclick = () => renderExamNew({ subject: b.dataset.subj, includeDone }));
  $app.querySelectorAll("[data-done]").forEach((b) => b.onclick = () => renderExamNew({ subject, includeDone: b.dataset.done === "1" }));
  $app.querySelectorAll("[data-ch]").forEach((c) => c.onchange = () => {
    c.checked ? picked.add(c.dataset.ch) : picked.delete(c.dataset.ch);
    rerender({ picked });
  });
  $app.querySelector("#make").onclick = async () => {
    // 단원끼리 모아서, 단원 안에서는 오래된 오답부터
    const ordered = chapters.filter((c) => picked.has(c)).flatMap((c) => [...groups[c]].sort((a, b) => a.createdAt - b.createdAt));
    const exam = {
      subject, title: $app.querySelector("#examTitle").value.trim() || `${SUBJECTS[subject].name} 맞춤형 문제`,
      chapters: chapters.filter((c) => picked.has(c)), noteIds: ordered.map((n) => n.id),
      status: "ready", createdAt: Date.now(),
    };
    loading(true, "시험지를 만드는 중…");
    try {
      const id = await DB.createExam(state.uid, exam);
      state.exams.unshift({ id, ...exam });
      loading(false); go(`#/exam/${id}`);
    } catch (e) { loading(false); toast("만들지 못했어요: " + e.message); }
  };
}

// ---------------------------------------------------------- 풀기 / 채점
export async function renderExam(id) {
  const exam = state.exams.find((e) => e.id === id);
  if (!exam) return go("#/exams");
  let s = state.exam;
  if (!s || s.id !== id) {
    loading(true, "시험지를 준비하는 중…");
    const items = await buildItems(exam);
    loading(false);
    s = state.exam = { id, items, mode: "screen", answers: {}, results: {}, submitted: false, review: exam.status === "graded" };
    if (s.review) { s.results = { ...(exam.results || {}) }; s.answers = { ...(exam.answers || {}) }; s.submitted = true; }
  }
  const { items } = s;
  const graded = items.filter((it) => s.results[it.n.id] != null).length;
  const score = items.filter((it) => s.results[it.n.id] === true).length;
  const allGraded = s.submitted && graded === items.length;
  const paper = s.mode === "paper";

  layout(`
    <header class="subject-head" style="${subjVars(exam.subject)}">
      <a href="#/exams" class="back">‹</a>
      <span class="s-icon">${SUBJECTS[exam.subject].icon}</span>
      <div><small>${SUBJECTS[exam.subject].name} · ${items.length}문제</small><h1>${esc(exam.title)}</h1></div>
    </header>
    <div class="btn-row sub">
      <a class="btn" href="#/print/${id}">🖨️ 인쇄하기</a>
      <button class="btn danger ghost" id="delExam">🗑️ 삭제</button>
    </div>
    ${s.review ? `<section class="card result ${score === items.length ? "perfect" : ""}">
        <div class="big-emoji">${score === items.length ? "🏆" : "📊"}</div>
        <h2>${items.length}문제 중 ${score}문제 정답</h2>
        <p class="muted">${exam.gradedAt ? fmtDate(exam.gradedAt) + "에 채점했어요." : ""} 틀린 문제는 오답노트의 <b>학습 중</b>으로 옮겨졌어요.</p>
        <button class="btn primary" id="retry">🔁 처음부터 다시 풀기</button>
      </section>` : `<div class="tabs pill">
        <button class="tab ${paper ? "" : "on"}" data-mode="screen">📱 화면에서 풀기</button>
        <button class="tab ${paper ? "on" : ""}" data-mode="paper">📄 종이 답 채점하기</button>
      </div>
      ${paper ? `<p class="muted small center">인쇄한 시험지를 다 푼 뒤, 정답을 보면서 문제마다 ○/✕를 눌러요.</p>` : ""}`}
    ${items.length < exam.noteIds.length ? `<p class="warn">삭제된 오답 ${exam.noteIds.length - items.length}개는 빠졌어요.</p>` : ""}
    <section class="exam-list">
      ${items.map((it, i) => examItemHtml(it, i, s)).join("")}
    </section>
    ${s.review ? "" : paper || s.submitted
      ? `<button class="btn primary big full" id="finish" ${allGraded || (paper && graded === items.length) ? "" : "disabled"}>✅ 채점 결과 저장 (${graded}/${items.length})</button>`
      : `<button class="btn primary big full" id="submit">제출하고 채점하기</button>`}
  `, "exams");

  $app.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { s.mode = b.dataset.mode; s.submitted = false; s.results = {}; renderExam(id); });
  $app.querySelectorAll("[data-choice]").forEach((b) => b.onclick = () => {
    (s.answers[b.dataset.key] ||= {}).selected = +b.dataset.choice;
    b.parentElement.querySelectorAll(".choice").forEach((x) => x.classList.toggle("sel", x === b));
  });
  $app.querySelectorAll("[data-text]").forEach((t) => t.oninput = () => { (s.answers[t.dataset.key] ||= {}).text = t.value; });
  $app.querySelectorAll("[data-self]").forEach((b) => b.onclick = () => { s.results[b.dataset.self] = b.dataset.v === "1"; renderExamKeepScroll(id); });
  $app.querySelector("#submit")?.addEventListener("click", async () => {
    const empty = items.filter((it) => !hasAnswer(it.o, s.answers[it.n.id] || {}, inputOpts(it))).length;
    if (empty && !(await confirmBox("아직 안 푼 문제가 있어요", `${empty}문제가 비어 있어요. 이대로 제출할까요?`, "제출"))) return;
    items.forEach((it) => {
      const a = s.answers[it.n.id] || {};
      if (!hasAnswer(it.o, a, inputOpts(it))) s.results[it.n.id] = false;
      else s.results[it.n.id] = it.o ? autoGrade(it.o, a) : null;
    });
    s.submitted = true;
    renderExam(id);
  });
  $app.querySelector("#finish")?.addEventListener("click", () => saveResults(exam, s));
  $app.querySelector("#retry")?.addEventListener("click", () => {
    Object.assign(s, { review: false, submitted: false, answers: {}, results: {}, mode: "screen" });
    renderExam(id);
  });
  $app.querySelector("#delExam").onclick = async () => {
    if (!(await confirmBox("이 시험지를 삭제할까요?", "오답노트 기록은 그대로 남아요.", "삭제", true))) return;
    await DB.deleteExam(state.uid, id);
    state.exams = state.exams.filter((e) => e.id !== id); state.exam = null;
    go("#/exams");
  };
}
function renderExamKeepScroll(id) { const y = window.scrollY; renderExam(id).then(() => window.scrollTo(0, y)); }

function examItemHtml(it, i, s) {
  const id = it.n.id, a = s.answers[id] || {}, r = s.results[id];
  const t = it.o ? typeOf(it.o) : null;
  const paper = s.mode === "paper" && !s.review;
  const showAnswer = s.submitted || paper || s.review;
  const label = it.o ? TYPE_LABEL[t] : "정답 정보 없음";
  const selfCheck = `<div class="self-check"><span>${it.o ? "모범 답안과 비교해 보세요" : "정답을 확인하고 체크해요"}</span>
      <button class="ok ${r === true ? "on" : ""}" data-self="${id}" data-v="1">○ 맞았어요</button>
      <button class="no ${r === false ? "on" : ""}" data-self="${id}" data-v="0">✕ 틀렸어요</button></div>`;
  return `<article class="card exam-item ${r === true ? "is-ok" : r === false ? "is-no" : ""}" style="${subjVars(it.n.subject)}">
    <div class="ei-head">
      <b class="ei-num">${i + 1}</b>
      <span class="ei-ch">${esc(chapterOf(it.n))}</span>
      <span class="ei-type">${label}</span>
      ${r === true ? `<span class="mark ok">○</span>` : r === false ? `<span class="mark no">✕</span>` : ""}
    </div>
    ${questionHtml(it)}
    ${it.marked ? `<p class="warn small">채점 표시가 보이면 <a href="#/note/${id}">오답노트</a>에서 🧽 지우개로 지워 주세요.</p>` : ""}
    ${paper ? "" : answerInput(gradeTarget(it), a, { ...inputOpts(it), checked: s.submitted && t !== "essay" && !!it.o })}
    ${showAnswer ? `<div class="feedback ${r === true ? "ok" : r === false ? "no" : "neutral"}">
        ${it.o ? `<b>정답: ${esc(answerText(it.o))}</b>${it.o.explanation ? `<p>${esc(it.o.explanation)}</p>` : ""}` : `<p>AI 분석 전이라 정답 정보가 없어요. 교과서·선생님 답으로 확인해요.</p>`}
        ${!s.review && (paper || r == null || t === "essay" || !it.o) && (paper || s.submitted) ? selfCheck : ""}
      </div>` : ""}
  </article>`;
}

async function saveResults(exam, s) {
  const results = {}, answers = {};
  s.items.forEach((it) => { results[it.n.id] = !!s.results[it.n.id]; if (s.answers[it.n.id]) answers[it.n.id] = s.answers[it.n.id]; });
  const score = Object.values(results).filter(Boolean).length;
  const patch = { status: "graded", results, answers, score, total: s.items.length, gradedAt: Date.now(), mode: s.mode };
  loading(true, "채점 결과를 저장하는 중…");
  try {
    await DB.updateExam(state.uid, exam.id, patch);
    Object.assign(exam, patch);
    // 다시 틀린 문제는 오답노트 "학습 중"으로 돌려보낸다
    await Promise.all(s.items.filter((it) => !results[it.n.id] && it.n.status === "done").map((it) => {
      it.n.status = "learning";
      return DB.updateNote(state.uid, it.n.id, { status: "learning" });
    }));
    Object.assign(s, { review: true, submitted: true });
    loading(false);
    toast(score === s.items.length ? "모두 맞혔어요! 🎉" : "저장했어요. 틀린 문제는 동일 유형 문제로 다시 연습해요 💪");
    renderExam(exam.id);
  } catch (e) { loading(false); toast("저장하지 못했어요: " + e.message); }
}

// ---------------------------------------------------------- 인쇄
export async function renderPrint(id) {
  const exam = state.exams.find((e) => e.id === id);
  if (!exam) return go("#/exams");
  loading(true, "인쇄용 시험지를 준비하는 중…");
  const items = await buildItems(exam);
  loading(false);
  document.body.classList.add("print-mode");
  const p = state.profile || {};
  const answerSpace = (it) => {
    const t = it.o ? typeOf(it.o) : "short";
    if (t === "choice" && !it.image) return `<ol class="p-choices">${it.o.choices.map((c, i) => `<li><span>${NUM[i]}</span> ${esc(c)}</li>`).join("")}</ol>`;
    if (t === "choice") return "";
    if (t === "essay") return `<div class="p-essay"></div>`;
    return `<div class="p-short">답: <span></span></div>`;
  };
  $app.innerHTML = `
    <div class="print-bar no-print">
      <a class="btn" href="#/exam/${id}">‹ 돌아가기</a>
      <button class="btn primary" id="doPrint">🖨️ 인쇄하기</button>
      <label class="check inline"><input type="checkbox" id="withAns" checked><span>정답·해설지 함께 인쇄</span></label>
    </div>
    ${items.some((it) => it.marked) ? `<p class="warn no-print">채점 표시가 남아 있는 사진 문제가 있어요. 오답노트에서 🧽 지우개로 지우면 깨끗하게 인쇄돼요.</p>` : ""}
    <div class="paper">
      <header class="p-head">
        <div><small>${SUBJECTS[exam.subject].name} · 맞춤형 문제</small><h1>${esc(exam.title)}</h1></div>
        <table><tr><th>이름</th><td>${esc(p.name || "")}</td><th>날짜</th><td></td><th>점수</th><td>&nbsp;&nbsp;&nbsp;&nbsp;/ ${items.length}</td></tr></table>
      </header>
      <div class="p-items">
        ${items.map((it, i) => `<section class="p-item">
          <div class="p-q"><b>${i + 1}.</b> ${it.image ? `<img src="${it.image}" alt="">` : `<span class="pre">${esc(it.o.question)}</span>`}</div>
          ${answerSpace(it)}
        </section>`).join("")}
      </div>
      <section class="p-answers" id="ansSheet">
        <h2>정답과 해설 · ${esc(exam.title)}</h2>
        ${items.map((it, i) => `<div class="p-ans"><b>${i + 1}.</b> <span class="p-ch">[${esc(chapterOf(it.n))}]</span>
          ${it.o ? `<b>${esc(answerText(it.o))}</b>${it.o.explanation ? `<p>${esc(it.o.explanation)}</p>` : ""}` : "<p>정답 정보 없음 (AI 분석 전)</p>"}</div>`).join("")}
      </section>
    </div>`;
  window.scrollTo(0, 0);
  $app.querySelector("#withAns").onchange = (e) => $app.querySelector("#ansSheet").classList.toggle("no-print", !e.target.checked);
  $app.querySelector("#doPrint").onclick = () => window.print();
}
