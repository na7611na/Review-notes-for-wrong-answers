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
export const answerText = (p) => typeOf(p) === "choice" ? `${NUM[p.answer]} ${p.choices[p.answer] ?? ""}` : String(p.answer ?? "");
export const TYPE_LABEL = { choice: "객관식", short: "단답형", essay: "서술형" };

/**
 * 답 입력 영역 HTML
 * @param p 문제  @param a { selected, text }  @param o { checked, key, numbersOnly(보기 글자 없이 번호만) , count(보기 수) }
 */
export function answerInput(p, a, o = {}) {
  const t = typeOf(p);
  if (t === "choice" || o.numbersOnly) {
    const count = o.count || p?.choices?.length || 5;
    return `<div class="choices ${o.numbersOnly ? "nums" : ""}">${Array.from({ length: count }, (_, i) => {
      let cls = "";
      if (o.checked && p) cls = i === p.answer ? "correct" : i === a.selected ? "wrong" : "dim";
      else if (i === a.selected) cls = "sel";
      return `<button class="choice ${cls}" data-choice="${i}" data-key="${o.key ?? ""}" ${o.checked ? "disabled" : ""}><span class="no">${NUM[i]}</span>${o.numbersOnly ? "" : esc(p.choices[i])}</button>`;
    }).join("")}</div>`;
  }
  const ph = t === "essay" ? "풀이와 답을 써 보세요" : "답을 입력하세요";
  const field = t === "essay"
    ? `<textarea class="answer-text" rows="4" data-text data-key="${o.key ?? ""}" placeholder="${ph}" ${o.checked ? "disabled" : ""}>${esc(a.text || "")}</textarea>`
    : `<input class="answer-text" data-text data-key="${o.key ?? ""}" placeholder="${ph}" value="${esc(a.text || "")}" ${o.checked ? "disabled" : ""} autocomplete="off">`;
  return field;
}

/** 자동 채점: true/false, 서술형·정답 모름은 null (스스로 ○/✕) */
export function autoGrade(p, a) {
  if (!p) return null;
  const t = typeOf(p);
  if (t === "choice") return a.selected === p.answer;
  if (t === "short") return gradeShort(a.text, p);
  return null;
}

export const hasAnswer = (p, a, o = {}) => (typeOf(p) === "choice" || o.numbersOnly) ? a.selected != null : !!String(a.text || "").trim();
