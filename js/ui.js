// 여러 화면에서 함께 쓰는 상태와 화면 도구
import { SUBJECTS } from "./data.js";

export const $app = document.getElementById("app");
export const state = { uid: null, profile: null, notes: [], custom: [], exams: [], practice: null, draft: null, exam: null };

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const go = (hash) => { if (location.hash === hash) window.dispatchEvent(new HashChangeEvent("hashchange")); else location.hash = hash; };
export const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}월 ${d.getDate()}일`; };
export const noteById = (id) => state.notes.find((n) => n.id === id);

// ---------- 수식: $...$ 안의 LaTeX를 교과서 모양(분수꼴 등)으로 바꿔 그린다
export function renderMath(root = document.body) {
  if (!window.renderMathInElement) return;
  window.renderMathInElement(root, {
    delimiters: [{ left: "$", right: "$", display: false }],
    throwOnError: false,
    macros: { "\\frac": "\\dfrac" }, // 분수를 작게 줄이지 않고 교과서 크기로
  });
}
// 화면·팝업이 바뀔 때마다 새로 생긴 수식을 그린다
let mathTimer = null;
new MutationObserver(() => { clearTimeout(mathTimer); mathTimer = setTimeout(() => renderMath(), 0); })
  .observe(document.body, { childList: true, subtree: true });

export function toast(msg, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => { el.classList.remove("show"); setTimeout(() => el.remove(), 300); }, ms);
}
export function loading(on, msg = "잠시만 기다려 주세요…") {
  let el = document.getElementById("loading");
  if (!on) { el?.remove(); return; }
  if (!el) { el = document.createElement("div"); el.id = "loading"; document.body.appendChild(el); }
  el.innerHTML = `<div class="loading-box"><div class="spinner"></div><p>${esc(msg)}</p></div>`;
}
export function modal(html, onMount, cls = "") {
  const el = document.createElement("div");
  el.className = "modal-back";
  el.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  el.addEventListener("click", (e) => { if (e.target === el || e.target.closest("[data-close]")) el.remove(); });
  document.body.appendChild(el);
  onMount?.(el);
  return el;
}
export function confirmBox(title, msg, yes = "확인", danger = false) {
  return new Promise((resolve) => {
    modal(`<h3>${esc(title)}</h3><p class="muted center">${msg}</p>
      <div class="btn-row"><button class="btn ${danger ? "danger" : "primary"}" data-yes>${esc(yes)}</button><button class="btn ghost" data-close>취소</button></div>`, (el) => {
      el.querySelector("[data-yes]").onclick = () => { el.remove(); resolve(true); };
      el.querySelector("[data-close]").addEventListener("click", () => resolve(false));
    });
  });
}

export const subjVars = (key) => `--sc:${SUBJECTS[key].color};--ss:${SUBJECTS[key].soft}`;
export const subjChip = (key) => `<span class="subj-chip" style="${subjVars(key)}">${SUBJECTS[key].icon} ${SUBJECTS[key].name}</span>`;
export const statusBadge = (n) => n.status === "done" ? `<span class="badge done">✅ 학습 완료</span>` : `<span class="badge learning">✏️ 학습 중</span>`;

export function layout(body, active = "") {
  document.body.classList.remove("print-mode");
  $app.innerHTML = `
    <main class="page">${body}</main>
    <nav class="bottom-nav">
      <a href="#/home" class="${active === "home" ? "on" : ""}"><span>🏠</span>홈</a>
      <a href="#/exams" class="${active === "exams" ? "on" : ""}"><span>📝</span>맞춤형</a>
      <a href="#/new" class="cam"><span>📷</span>찍기</a>
      <a href="#/settings" class="${active === "settings" ? "on" : ""}"><span>⚙️</span>설정</a>
    </nav>`;
  renderMath($app);
  window.scrollTo(0, 0);
}
