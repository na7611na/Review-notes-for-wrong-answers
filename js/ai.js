// ============================================================
//  AI(Gemini, Firebase AI Logic 무료 사용량) 연동
//  실패하면 예외를 던지고, 화면 쪽에서 문제은행으로 대체합니다.
//
//  문제 형식 (앱 전체 공통)
//   - 객관식 { type:"choice", question, choices:[2~5개], answer: 정답 번호(0부터), explanation }
//   - 단답형 { type:"short",  question, answer: "정답", accept:["다른 정답 표기"], explanation }
//   - 서술형 { type:"essay",  question, answer: "모범 답안", explanation }
// ============================================================
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { AI_MODELS } from "./firebase-config.js";
import { SUBJECTS } from "./data.js";

let ai = null;
export function initAI(app) {
  try { ai = getAI(app, { backend: new GoogleAIBackend() }); } catch (e) { console.warn("AI 초기화 실패", e); ai = null; }
}

const STYLE = `
- 학생 눈높이에 맞춰 친근한 존댓말(~해요)로 써요.
- 수식은 교과서처럼 보이도록 $ 사이에 LaTeX로 써요. 예: 분수 $\\frac{1}{2}$, 대분수 $2\\frac{1}{3}$, 거듭제곱 $x^{2}$, 루트 $\\sqrt{3}$, 곱셈 $3 \\times 4$, 나눗셈 $\\div$, 부등호 $\\le$.
- 수식이 아닌 글(한글, 단위 등)은 $ 밖에 써요. JSON 안이므로 역슬래시는 두 번(\\\\) 써요.
- 정답이 확실한 문제만 내고, 계산 문제는 정답을 직접 다시 검산해요.
- explanation에는 풀이 과정을 2~3문장으로 써요.`;

// 동일 유형 문제를 만드는 규칙
const SAME_TYPE = `
[동일 유형 문제 만드는 규칙 - 꼭 지켜요]
- 원래 문제를 "복사한 뒤 일부만 바꾼" 문제여야 해요. 새로운 문제를 지어내지 않아요.
- 발문(묻는 말), 문장 구조, 조건의 개수, 풀이 순서, 필요한 개념은 원래 문제와 똑같이 둬요.
- 바꾸는 것은 다음 중 한두 가지뿐이에요:
  · 수학·과학: 숫자(계수, 길이, 개수 등)만 바꿔요. 답이 깔끔하게 떨어지도록 숫자를 고르고, 단위·문맥은 그대로 둬요.
  · 국어·영어·사회: 같은 발문을 유지하고, 예문·단어·자료·보기 중 일부만 비슷한 수준의 다른 것으로 바꿔요.
  · 보기: 보기 개수와 배열 방식(숫자 크기순 등)은 원래 문제와 같게 하고, 보기 내용만 살짝 바꿔 정답 번호가 원래와 달라지게 해요.
- 형식(type)과 보기 개수는 원래 문제와 같아요. multi면 소문항 개수와 각 소문항의 형식도 같게 해요.`;

// AI가 JSON 안에 \frac 처럼 역슬래시를 한 번만 쓰면 \f(폼피드)로 깨지므로 두 번으로 고친다
const LATEX_CMD = /(?<!\\)\\(?=(?:frac|dfrac|tfrac|times|div|sqrt|cdot|cdots|ldots|le|leq|ge|geq|neq|ne|pm|mp|pi|theta|alpha|beta|gamma|angle|triangle|circ|left|right|text|mathrm|overline|vec|bar|square|therefore|because|approx|infty|log|sin|cos|tan|lim|sum|int|perp|parallel|sim|equiv|rightarrow|Rightarrow|quad|qquad|degree)(?![a-zA-Z]))/g;
const fixLatexEscapes = (t) => t.replace(LATEX_CMD, "\\\\");

async function run(parts) {
  if (!ai) throw new Error("AI_UNAVAILABLE");
  let lastErr;
  for (const name of AI_MODELS) {
    try {
      const model = getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: "application/json", temperature: 0.4 } }, { timeout: 60_000 });
      const res = await model.generateContent(parts);
      const text = res.response.text().trim().replace(/^```(json)?/i, "").replace(/```$/, "");
      return JSON.parse(fixLatexEscapes(text));
    } catch (e) {
      lastErr = e;
      console.warn(`AI 모델 ${name} 실패, 다음 모델 시도`, e);
      // 프로젝트 설정 문제는 어느 모델이든 같으니 바로 중단, 그 밖에는(종료·사용량 초과·접속 몰림·시간 초과) 다음 모델
      if (/genai config not found|api-not-enabled|PERMISSION_DENIED|API key/i.test(String(e?.message))) break;
    }
  }
  throw lastErr;
}

// AI가 준 문제 하나를 검사하고 앱 형식으로 정리 (잘못되면 null)
export function cleanProblem(p) {
  if (!p) return null;
  // 여러 문항: 공통 지문 + 소문항(1),(2)… 각각 답이 따로 있다
  if (p.type === "multi" || (Array.isArray(p.parts) && p.parts.length > 1)) {
    const parts = (p.parts || []).map((q) => { const c = cleanProblem({ ...q, type: q.type === "multi" ? "short" : q.type }); return c && { label: String(q.label || "").trim(), ...c }; });
    if (parts.length < 2 || parts.length > 8 || parts.some((q) => !q)) return null;
    parts.forEach((q, i) => { if (!q.label) q.label = `(${i + 1})`; });
    return { type: "multi", question: String(p.question || "").trim() || "다음 물음에 답하시오.", parts, explanation: String(p.explanation || "") };
  }
  if (typeof p.question !== "string" || !p.question.trim()) return null;
  const type = ["choice", "short", "essay"].includes(p.type) ? p.type : Array.isArray(p.choices) && p.choices.length ? "choice" : "short";
  const explanation = String(p.explanation || "");
  if (type === "choice") {
    const choices = (p.choices || []).map(String);
    const answer = Number(p.answer);
    if (choices.length < 2 || choices.length > 5 || !Number.isInteger(answer) || answer < 0 || answer >= choices.length) return null;
    return { type, question: p.question, choices, answer, explanation };
  }
  const answer = String(p.answer ?? "").trim();
  if (!answer) return null;
  return { type, question: p.question, answer, accept: (p.accept || []).map(String), explanation };
}
const cleanList = (list) => (Array.isArray(list) ? list : []).map(cleanProblem).filter(Boolean);

const FORMAT_HELP = `type은 "choice"(객관식), "short"(단답형: 숫자·단어·짧은 답), "essay"(서술형) 중 하나예요.
- choice: choices에 보기 내용을 번호(①, 1) 등) 없이 순서대로 넣고, answer는 정답 보기의 번호(0부터 시작)예요.
- short: answer에 정답, accept에 같은 뜻의 다른 표기(예: "5", "x=5", "5개")를 넣어요.
- essay: answer에 모범 답안을 넣어요.
- multi: 한 문제 안에 (1), (2)… 또는 ㉠, ㉡처럼 답을 따로 쓰는 칸이 여러 개면 type을 "multi"로 해요.
  question에는 공통 지문·조건만 쓰고, parts에 소문항을 순서대로 넣어요.
  parts의 각 항목: {"label":"(1)","type":"short","question":"소문항 내용","choices":[],"answer":"","accept":[],"explanation":""}
  (소문항 type도 choice/short/essay 중 하나, 답이 하나뿐인 문제는 multi로 하지 않아요)`;

// 예전 화면 호환용 글자 정보 (문제 글 / 정답과 풀이)
const choiceLines = (q) => (q.choices ? "\n" + q.choices.map((c, i) => `${"①②③④⑤"[i]} ${c}`).join("\n") : "");
export function problemTextOf(o) {
  if (o.type === "multi") return o.question + "\n" + o.parts.map((q) => `${q.label} ${q.question}${choiceLines(q)}`).join("\n");
  return o.question + choiceLines(o);
}
const answerOf = (q) => (q.type === "choice" ? `${"①②③④⑤"[q.answer]} ${q.choices[q.answer]}` : q.answer);
export function correctAnswerOf(o) {
  const ans = o.type === "multi" ? o.parts.map((q) => `${q.label} ${answerOf(q)}`).join("\n") : answerOf(o);
  return ans + (o.explanation ? `\n${o.explanation}` : "");
}

// ---------------------------------------------------------- 그림
export function validBox(box) {
  return Array.isArray(box) && box.length === 4 && box.every((v) => Number.isFinite(+v)) && +box[2] > +box[0] && +box[3] > +box[1] ? box.map(Number) : null;
}
/**
 * 넉넉하게 자른 그림 사진에서
 *  box: 인쇄된 그림만 꽉 맞는 영역, marks: 지워도 되는 학생 손글씨 영역들 (모두 이 사진 기준 0~1000)
 */
export async function refineFigure(imageBase64) {
  const data = await run([`사진은 시험지에서 그림 부분을 넉넉하게 잘라 낸 것이에요.
1. box: 이 안에서 "인쇄된 그림"(도형·그래프의 선, 그림 속에 인쇄된 길이·이름·숫자)만 꽉 맞게 감싸는 영역
   - 문제 글 줄, 보기, 다른 문제의 글자는 넣지 않아요. 여백은 아주 조금만 둬요.
2. marks: 학생이 펜·연필로 직접 쓴 글씨·숫자·화살표·밑줄·동그라미가 있는 영역들
   - 인쇄된 글자(활자체, 예: "6 cm", "A")는 절대 넣지 않아요. 손글씨만 넣어요.
   - 인쇄된 그림 선과 겹치는 손글씨는 넣지 않아요 (지우면 그림 선도 지워져요).
   - 없으면 빈 배열이에요.
JSON 형식: {"box":[ymin, xmin, ymax, xmax], "marks":[[ymin, xmin, ymax, xmax]]} (이 사진 전체를 0~1000으로 본 값)`, { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }]);
  const marks = (Array.isArray(data.marks) ? data.marks : []).map(validBox).filter(Boolean)
    // 너무 큰 영역은 잘못 찾은 것일 수 있어 지우지 않는다
    .filter((m) => ((m[2] - m[0]) * (m[3] - m[1])) / 1e6 < 0.15);
  return { box: validBox(data.box), marks };
}

// ---------------------------------------------------------- 동일 유형 검사
// 숫자는 #로 바꾸고 띄어쓰기를 지운 뒤 두 글자씩 비교 (숫자만 바꾼 문제는 거의 1.0)
const shape = (t) => String(t || "").replace(/[0-9０-９]+(\.[0-9]+)?/g, "#").replace(/\s+/g, "");
function similarity(a, b) {
  const grams = (t) => { const m = new Map(); for (let i = 0; i < t.length - 1; i++) { const g = t.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(shape(a)), B = grams(shape(b));
  let both = 0, total = 0;
  A.forEach((v, k) => { both += Math.min(v, B.get(k) || 0); total += v; });
  B.forEach((v) => (total += v));
  return total ? (2 * both) / total : 0;
}
// 수학·과학은 숫자만 바꾸므로 기준을 높게, 국어·영어·사회는 예문·자료가 바뀌므로 낮게
const MIN_SIM = { math: 0.55, science: 0.45, korean: 0.3, english: 0.3, social: 0.35 };

// 베꼈는지는 숫자까지 그대로 비교 (숫자만 바꾼 문제는 통과)
const same = (a, b) => String(a).replace(/\s+/g, "") === String(b).replace(/\s+/g, "");
const fullText = (p) => [p.question, ...(p.parts || []).map((q) => q.question)].join(" ");
function isSameType(p, o, subject) {
  if (!o) return true;
  if (p.type !== o.type) return false;
  if (o.type === "multi") {
    if (p.parts.length !== o.parts.length || p.parts.some((q, i) => q.type !== o.parts[i].type)) return false;
    if (same(fullText(p), fullText(o)) && same(JSON.stringify(p.parts.map((q) => q.choices)), JSON.stringify(o.parts.map((q) => q.choices)))) return false; // 그대로 베낌
    return similarity(fullText(p), fullText(o)) >= (MIN_SIM[subject] ?? 0.4);
  }
  if (o.type === "choice" && p.choices.length !== o.choices.length) return false;
  if (same(p.question, o.question) && JSON.stringify(p.choices) === JSON.stringify(o.choices)) return false; // 그대로 베낌
  return similarity(p.question, o.question) >= (MIN_SIM[subject] ?? 0.4);
}

/**
 * 원래 문제의 숫자·보기만 바꾼 동일 유형 문제를 count개 만든다.
 * 원래 문제와 너무 다르면 버리고 한 번 더 만든다.
 */
export async function sameTypeProblems({ original, subject, grade, unit, seen = [], count = 3, easierFirst = false }) {
  const o = { type: original.type, question: original.question, choices: original.choices, answer: original.answer, accept: original.accept, parts: original.parts };
  const out = [];
  let feedback = "";
  for (let attempt = 0; attempt < 2 && out.length < count; attempt++) {
    const prompt = `당신은 ${grade} 학생의 ${SUBJECTS[subject].name} 선생님이에요.
아래 "원래 문제"를 바탕으로 동일 유형 문제 ${count - out.length + 1}개를 만들어 주세요.

원래 문제(JSON): ${JSON.stringify(o)}
유형: ${unit || "(원래 문제와 같은 유형)"}
${seen.length ? `이미 낸 문제(같은 숫자·보기를 쓰지 않아요): ${seen.slice(-9).join(" / ")}` : ""}
${easierFirst ? "학생이 방금 틀렸으니 첫 문제는 숫자를 조금 더 쉽게 바꿔 주세요. (문장·형식은 그대로)" : ""}
${feedback}
${SAME_TYPE}
- 원래 문제의 문장을 거의 그대로 두세요. 단순 계산 문제나 다른 유형의 문제로 바꾸면 안 돼요.
- changed에는 원래 문제에서 무엇을 바꿨는지 짧게 써요 (예: "3→5, 10→12").
${original.hasFigure ? `- 원래 문제에 그림이 있어요. 학생은 원래 그림을 보며 풀어요. 그림의 모양은 그대로 두고, 그림에 적힌 숫자 대신 문제 글의 숫자를 바꿔요.` : ""}

${FORMAT_HELP}
${STYLE}

JSON 형식: {"problems":[${o.type === "multi"
    ? `{"type":"multi","question":"","parts":[${o.parts.map((q) => `{"label":"${q.label}","type":"${q.type}","question":"","choices":[],"answer":${q.type === "choice" ? 0 : '""'},"accept":[],"explanation":""}`).join(",")}],"explanation":"","changed":""}`
    : `{"type":"${o.type}","question":"","choices":[],"answer":0,"accept":[],"explanation":"","changed":""}`}]}`;
    const data = await run([prompt]);
    const fresh = cleanList(data.problems).filter((p) => !out.some((x) => x.question === p.question) && !seen.includes(p.question));
    const good = fresh.filter((p) => isSameType(p, original, subject));
    out.push(...good);
    if (good.length < fresh.length) {
      console.warn("원래 문제와 너무 다른 문제를 버렸어요", fresh.filter((p) => !good.includes(p)).map((p) => p.question));
      feedback = "[주의] 앞에서 만든 문제가 원래 문제와 문장이 너무 달라서 버렸어요. 원래 문제 문장을 복사한 뒤 숫자와 보기만 바꾸세요.";
    }
  }
  if (!out.length) throw new Error("NOT_SAME_TYPE");
  return out.slice(0, count);
}

/**
 * 틀린 문제 사진을 분석한다.
 * 1단계: 채점 표시를 뺀 문제를 문서(글)로 다시 쓰고, 그림이 있으면 그 위치를 찾는다.
 * 2단계: 그 문서를 바탕으로 동일 유형 문제 3개를 만든다.
 */
export async function analyzeProblem({ imageBase64, subject, grade, reasons, memo, bankUnits, chapter }) {
  const prompt = `당신은 ${grade} 학생의 ${SUBJECTS[subject].name} 과목 오답노트를 도와주는 선생님이에요.
사진은 학생이 틀린 문제예요. 학생이 고른 틀린 이유: ${reasons.length ? reasons.join(", ") : "(선택 안 함)"}
학생 메모: ${memo || "(없음)"}
${chapter ? `학생이 고른 단원: ${chapter} (chapter에는 이 이름을 그대로 써요)\n` : ""}
다음을 JSON으로 만들어 주세요.
1. readable: 사진에서 문제를 읽을 수 있으면 true, 아니면 false
2. original: 사진 속 문제를 "새 시험지"에 실을 수 있게 처음부터 다시 입력한 문서
   - 채점 표시(○, ✕, 빗금, 체크, 동그라미, 점수)와 학생이 쓴 답·풀이·밑줄·낙서는 모두 빼고, 인쇄된 문제만 옮겨요.
   - 문제 번호(예: "3.")는 빼요. 지문·<보기>·조건·단위는 한 글자도 빠짐없이 그대로 옮겨요.
   - 표는 question 안에 한 줄에 한 행씩 "| 칸 | 칸 |" 형식으로 옮겨요. 첫 행이 제목 행이면 그 다음 줄에 "|---|---|"를 넣어요. 표는 그림(hasFigure)으로 치지 않아요.
   - <보기>가 있으면 "<보기>" 한 줄 다음에 "ㄱ. 내용", "ㄴ. 내용"처럼 항목을 한 줄에 하나씩 써요.
   - hasFigure: 글로 옮길 수 없는 그림·도형·그래프·지도가 있으면 true
   - figureBox: 인쇄된 그림만 꽉 맞게 감싸는 영역 [ymin, xmin, ymax, xmax] (사진 전체를 0~1000으로 본 값).
     문제 글·보기·다른 문제·학생 필기는 넣지 않고, 그림의 선과 그림 속 인쇄된 글자(길이, 꼭짓점 이름 등)만 넣어요. 없으면 null
   - 그림이 있으면 question 끝에 그림이 무엇인지 쓰지 않아도 돼요 (그림은 사진에서 잘라 붙여요).
   - answer와 explanation은 이 문제의 정답과 풀이예요. 학생이 쓴 답이 아니라 올바른 정답이에요.
3. unit: 이 문제의 세부 유형 이름 (짧게, 예: "일차방정식의 활용 - 거리·속력·시간")
4. chapter: 교과서 단원 이름 (예: "일차방정식", "현재완료", "광합성")
5. concept: 이 유형을 풀기 위한 핵심 개념
   - title: 개념 이름 / summary: 한두 문장 설명 / points: 꼭 알아야 할 원리·공식 2~4개
   - tip: 학생이 고른 틀린 이유를 고려한 실수 방지 팁 한 문장
6. bankUnitId: 아래 목록 중 이 문제와 가장 가까운 단원의 id, 없으면 null
${bankUnits.map((u) => `   - ${u.id}: ${u.title}`).join("\n")}

${FORMAT_HELP}
${STYLE}

JSON 형식:
{"readable":true,
 "original":{"type":"choice","question":"","choices":["","","","",""],"answer":0,"accept":[],"explanation":"","hasFigure":false,"figureBox":null},
 (소문항이 여러 개면 original은 {"type":"multi","question":"공통 지문","parts":[…],"explanation":"","hasFigure":false,"figureBox":null})
 "unit":"","chapter":"",
 "concept":{"title":"","summary":"","points":[""],"tip":""},
 "bankUnitId":null}`;

  const data = await run([prompt, { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }]);
  const original = cleanProblem(data.original);
  if (!data.readable || !original || !data.concept) throw new Error("UNREADABLE");
  original.hasFigure = !!data.original.hasFigure;
  original.figureBox = original.hasFigure ? validBox(data.original.figureBox) : null;
  const unit = String(data.unit || "");
  const problems = await sameTypeProblems({ original, subject, grade, unit });
  return {
    original,
    // 예전 화면 호환용 글자 정보
    problemText: problemTextOf(original),
    correctAnswer: correctAnswerOf(original),
    unit,
    chapter: String(data.chapter || data.unit || ""),
    concept: {
      title: String(data.concept.title || ""), summary: String(data.concept.summary || ""),
      points: (data.concept.points || []).map(String), tip: String(data.concept.tip || ""),
    },
    problems,
    bankUnitId: bankUnits.some((u) => u.id === data.bankUnitId) ? data.bankUnitId : null,
  };
}

/** 틀렸을 때 추가로 풀 동일 유형 문제 3개 */
export function moreProblems({ note, grade, seen, wrongCount }) {
  if (!note.original) throw new Error("NO_ORIGINAL");
  return sameTypeProblems({ original: note.original, subject: note.subject, grade, unit: note.unit, seen, easierFirst: wrongCount > 0 });
}
