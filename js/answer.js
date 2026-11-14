// 객관식·단답형·서술형 답 입력과 채점
import { esc } from "./ui.js";

export const NUM = "①②③④⑤";

// 단답형 비교용 정리: 띄어쓰기·대소문자·"x =", "답:" 같은 앞말, 끝의 마침표 무시
// LaTeX 정답($\frac{1}{2}$ 등)을 입력하기 쉬운 꼴(1/2)로
const plainMath = (s) => String(s ?? "").replace(/(\d+)\s*\\[dt]?frac\{(\d+)\}\{(\d+)\}/g, (_, a, b, c) => `${+a * +c + +b}/${c}`).replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1/$2").replace(/\\sqrt\{([^{}]*)\}/g, "√$1")
  .replace(/\\times/g, "×").replace(/\\div/g, "÷").replace(/\\(left|right)/g, "").replace(/\^\{?(\d+)\}?/g, "^$1").replace(/[${}]/g, "").replace(/\\/g, "");
const norm = (s) => plainMath(s).normalize("NFKC").toLowerCase()
  .replace(/\s+/g, "").replace(/[−–]/g, "-").replace(/^(정답|답)[:：]?/, "").replace(/^[a-z]=/, "").replace(/[.。]$/, "");
function toNum(s) {
  const t = s.replace(/,/g, "");
  const m = t.match(/^(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)$/);
  if (m) return +m[1] / +m[2];
  return /^-?\d+(\.\d+)?$/.test(t) ? +t : NaN;
}
export function gradeShort(input, p) {
  const a = norm(input);
  if (!a) return false;
  const cands = [p.answer, ...(p.accept || [])].map(norm);
  if (cands.includes(a)) return true;
  // 숫자면 값으로 비교 (0.5 = 1/2)
  const x = toNum(a);
  return !isNaN(x) && cands.some((c) => { const y = toNum(c); return !isNaN(y) && Math.abs(x - y) < 1e-9; });
}

export const typeOf = (p) => p?.type || (p?.choices ? "choice" : "short");
export const isMulti = (p) => p?.type === "multi";
export const partLabel = (q, i) => q.label || `(${i + 1})`;
export const answerText = (p) => {
  if (isMulti(p)) return p.parts.map((q, i) => `${partLabel(q, i)} ${answerText(q)}`).join("   ");
  return typeOf(p) === "choice" ? `${NUM[p.answer]} ${p.choices[p.answer] ?? ""}` : String(p.answer ?? "");
};
export const TYPE_LABEL = { choice: "객관식", short: "단답형", essay: "서술형", multi: "여러 문항" };

// 소문항별 답 칸 (a.parts[i])
const slot = (a, part) => (part === "" || part == null ? a : ((a.parts ||= [])[+part] ||= {}));

function singleInput(p, a, o) {
  const t = typeOf(p);
  const attrs = `data-key="${o.key ?? ""}" data-part="${o.part ?? ""}"`;
  if (t === "choice" || o.numbersOnly) {
    const count = o.count || p?.choices?.length || 5;
    const long = !o.numbersOnly && !isShortChoices(p.choices);
    return `<div class="choices ${o.numbersOnly ? "nums" : long ? "" : "short"}">${Array.from({ length: count }, (_, i) => {
      let cls = "";
      if (o.checked && p) cls = i === p.answer ? "correct" : i === a.selected ? "wrong" : "dim";
      else if (i === a.selected) cls = "sel";
      return `<button class="choice ${cls}" data-choice="${i}" ${attrs} ${o.checked ? "disabled" : ""}><span class="no">${NUM[i]}</span>${o.numbersOnly ? "" : esc(p.choices[i])}</button>`;
    }).join("")}</div>`;
  }
  const ph = t === "essay" ? "풀이와 답을 써 보세요" : "답을 입력하세요";
  return t === "essay"
    ? `<textarea class="answer-text" rows="4" data-text ${attrs} placeholder="${ph}" ${o.checked ? "disabled" : ""}>${esc(a.text || "")}</textarea>`
    : `<input class="answer-text" data-text ${attrs} placeholder="${ph}" value="${esc(a.text || "")}" ${o.checked ? "disabled" : ""} autocomplete="off" enterkeyhint="next">`;
}

/**
 * 답 입력 영역 HTML
 * @param p 문제  @param a { selected, text, parts:[{selected,text}] }
 * @param o { checked, key, numbersOnly(보기 글자 없이 번호만), count(보기 수), partResults(소문항별 채점) }
 */
export function answerInput(p, a, o = {}) {
  if (!isMulti(p)) return singleInput(p, a, o);
  const done = p.parts.filter((q, i) => hasAnswer(q, (a.parts || [])[i] || {})).length;
  return `<div class="parts">
    ${o.checked ? "" : `<p class="parts-count" data-key="${o.key ?? ""}">✏️ 소문항 ${p.parts.length}개 중 <b>${done}</b>개 입력</p>`}
    ${p.parts.map((q, i) => {
      const r = o.partResults?.[i];
      return `<div class="part ${r === true ? "ok" : r === false ? "no" : ""}">
        <div class="part-q"><b class="part-label">${esc(partLabel(q, i))}</b><div>${richText(q.question)}</div>${r === true ? `<span class="mark ok">○</span>` : r === false ? `<span class="mark no">✕</span>` : ""}</div>
        ${singleInput(q, (a.parts || [])[i] || {}, { ...o, part: i })}
        ${o.checked ? `<p class="part-ans">정답: ${esc(answerText(q))}</p>` : ""}
      </div>`;
    }).join("")}
  </div>`;
}

// 읽기 전용: 소문항 목록 (문서 보기·종이 채점용)
export function partsHtml(p) {
  return `<ol class="parts-view">${p.parts.map((q, i) => `<li><b>${esc(partLabel(q, i))}</b> <div class="pv-q">${richText(q.question)}</div>
    ${typeOf(q) === "choice" ? `<div class="pv-choices ${isShortChoices(q.choices) ? "short" : ""}">${q.choices.map((c, j) => `<span>${NUM[j]} ${esc(c)}</span>`).join("")}</div>` : ""}</li>`).join("")}</ol>`;
}

/** 소문항별 자동 채점 결과 */
export const gradeParts = (p, a) => p.parts.map((q, i) => autoGrade(q, (a.parts || [])[i] || {}));

/** 자동 채점: true/false, 서술형·정답 모름은 null (스스로 ○/✕). 여러 문항은 하나라도 틀리면 false */
export function autoGrade(p, a) {
  if (!p) return null;
  if (isMulti(p)) {
    const rs = gradeParts(p, a);
    return rs.includes(false) ? false : rs.includes(null) ? null : true;
  }
  const t = typeOf(p);
  if (t === "choice") return a.selected === p.answer;
  if (t === "short") return gradeShort(a.text, p);
  return null;
}

export const hasAnswer = (p, a, o = {}) => {
  if (isMulti(p)) return p.parts.every((q, i) => hasAnswer(q, (a.parts || [])[i] || {}));
  return (typeOf(p) === "choice" || o.numbersOnly) ? a.selected != null : !!String(a.text || "").trim();
};

/**
 * 답 입력 이벤트 연결. getA(key) 는 그 문제의 답 객체를 돌려준다.
 * Enter를 누르면 다음 빈칸으로 넘어가고, 마지막 칸이면 onSubmit
 */
export function bindAnswers(root, getA, { getP, onChange, onSubmit } = {}) {
  // 여러 문항이면 "몇 개 입력했는지"를 바로 고친다
  const refreshCount = (key) => {
    const p = getP?.(key), box = root.querySelector(`.parts-count[data-key="${key}"] b`);
    if (box && isMulti(p)) box.textContent = p.parts.filter((q, i) => hasAnswer(q, (getA(key).parts || [])[i] || {})).length;
  };
  root.querySelectorAll("[data-choice]").forEach((b) => b.onclick = () => {
    slot(getA(b.dataset.key), b.dataset.part).selected = +b.dataset.choice;
    b.parentElement.querySelectorAll(".choice").forEach((x) => x.classList.toggle("sel", x === b));
    onChange?.(b.dataset.key); refreshCount(b.dataset.key);
  });
  const fields = [...root.querySelectorAll("[data-text]")];
  fields.forEach((t, i) => {
    t.oninput = () => { slot(getA(t.dataset.key), t.dataset.part).text = t.value; onChange?.(t.dataset.key); refreshCount(t.dataset.key); };
    if (t.tagName === "INPUT") t.onkeydown = (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      e.preventDefault();
      const next = fields[i + 1];
      if (next) next.focus(); else onSubmit?.();
    };
  });
}

// ---------- 문제 글 꾸미기: <보기> 상자
// "<보기>" 줄과 그 아래 "ㄱ. …", "(ㄴ) …" 같은 줄들을 교과서처럼 상자 안에 넣고,
// 짧으면 한 줄에 2개씩 놓는다. 그 밖의 글은 줄바꿈을 그대로 둔다.
const BOGI_HEAD = /^\s*[<〈《\[［(]\s*보\s*기\s*[>〉》\]］)]\s*$/;
const BOGI_ITEM = /^\s*(\(\s*[ㄱ-ㅎ]\s*\)|[ㄱ-ㅎ]\s*[.)．]|\(\s*[a-eA-E가-마]\s*\)|[a-eA-E가-마]\s*[.)]|[①-⑩])\s*(.*)$/;
function bogiBox(items, titled) {
  const two = Math.max(...items.map((it) => choiceLen(it.text))) <= 14;
  const label = (l) => l.replace(/[()\s.)．]/g, "") + (/^[①-⑩]$/.test(l.trim()) ? "" : ".");
  return `<div class="bogi">${titled ? `<div class="bogi-title">보기</div>` : ""}<div class="bogi-items ${two ? "two" : ""}">${items
    .map((it) => `<div class="bogi-item"><b>${esc(label(it.label))}</b><span>${esc(it.text)}</span></div>`).join("")}</div></div>`;
}
// "| 칸 | 칸 |" 줄들을 표로 (다음 줄이 |---| 이면 첫 줄은 제목 행)
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
function tableHtml(rows) {
  const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const head = rows.length > 1 && TABLE_SEP.test(rows[1]);
  const body = rows.filter((r, i) => !(head && i === 1));
  return `<div class="rt-table-wrap"><table class="rt-table">${body.map((r, i) => `<tr>${cells(r).map((c) => (head && i === 0 ? `<th>${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</table></div>`;
}

export function richText(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) out.push(`<span class="rt-text">${esc(buf.join("\n").replace(/^\n+|\n+$/g, ""))}</span>`); buf = []; };
  for (let i = 0; i < lines.length; i++) {
    if (TABLE_ROW.test(lines[i]) && TABLE_ROW.test(lines[i + 1] || "")) {
      let j = i; while (j < lines.length && TABLE_ROW.test(lines[j])) j++;
      flush(); out.push(tableHtml(lines.slice(i, j))); i = j - 1; continue;
    }
    const titled = BOGI_HEAD.test(lines[i]);
    let j = titled ? i + 1 : i;
    while (j < lines.length && !lines[j].trim() && titled) j++; // 제목 아래 빈 줄 건너뛰기
    const items = [];
    for (; j < lines.length; j++) {
      const m = lines[j].match(BOGI_ITEM);
      if (!m) break;
      items.push({ label: m[1], text: m[2] });
    }
    // 제목이 있으면 1개 이상, 제목 없이 ㄱ·ㄴ·ㄷ만 있으면 2줄 이상일 때 상자로
    if ((titled && items.length) || (!titled && items.length >= 2 && /[ㄱ-ㅎ]/.test(items[0].label))) {
      flush(); out.push(bogiBox(items, titled)); i = j - 1;
    } else buf.push(lines[i]);
  }
  flush();
  return out.join("");
}

// ---------- 그림
/** 그림 한 개 (사진에서 잘라 정리한 그림) */
export function figureHtml({ img, cls = "" } = {}) {
  return img ? `<div class="fig ${cls}"><img src="${img}" alt="그림"></div>` : "";
}

// 화면에서 보기를 한 줄에 2개씩 놓아도 될 만큼 짧은지
export const isShortChoices = (choices) => Math.max(...choices.map(choiceLen)) <= 10;

// 보기 글자 길이 (수식 기호 제외) — 인쇄·화면에서 한 줄에 몇 개 놓을지 정할 때 씀
export function choiceLen(c) {
  const t = String(c);
  const fracs = (t.match(/\\[dt]?frac/g) || []).length;
  return t.replace(/\\[a-zA-Z]+/g, "").replace(/[${}^_\s]/g, "").length + fracs;
}
