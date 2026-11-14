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
- 수식은 LaTeX를 쓰지 말고 x², √2, ½, ×, ÷, ≤ 같은 유니코드 문자로 써요.
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
- 형식(type)과 보기 개수는 원래 문제와 같아요.`;

async function run(parts) {
  if (!ai) throw new Error("AI_UNAVAILABLE");
  let lastErr;
  for (const name of AI_MODELS) {
    try {
      const model = getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: "application/json", temperature: 0.4 } });
      const res = await model.generateContent(parts);
      const text = res.response.text().trim().replace(/^```(json)?/i, "").replace(/```$/, "");
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      // 모델이 없어졌으면(404) 다음 모델 시도, 그 밖의 오류(사용량 초과 등)는 바로 중단
      if (!/404|not found|not supported/i.test(String(e?.message))) break;
    }
  }
  throw lastErr;
}

// AI가 준 문제 하나를 검사하고 앱 형식으로 정리 (잘못되면 null)
export function cleanProblem(p) {
  if (!p || typeof p.question !== "string" || !p.question.trim()) return null;
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
- essay: answer에 모범 답안을 넣어요.`;

/**
 * 틀린 문제 사진을 분석해 원래 문제(채점 표시 제거), 단원, 핵심 개념, 동일 유형 문제 3개를 만든다.
 */
export async function analyzeProblem({ imageBase64, subject, grade, reasons, memo, bankUnits, chapter }) {
  const prompt = `당신은 ${grade} 학생의 ${SUBJECTS[subject].name} 과목 오답노트를 도와주는 선생님이에요.
사진은 학생이 틀린 문제예요. 학생이 고른 틀린 이유: ${reasons.length ? reasons.join(", ") : "(선택 안 함)"}
학생 메모: ${memo || "(없음)"}
${chapter ? `학생이 고른 단원: ${chapter} (chapter에는 이 이름을 그대로 써요)\n` : ""}
다음을 JSON으로 만들어 주세요.
1. readable: 사진에서 문제를 읽을 수 있으면 true, 아니면 false
2. original: 사진 속 원래 문제를 "새 시험지"에 다시 실을 수 있게 깨끗하게 옮겨 적은 것
   - 채점 표시(○, ✕, 빗금, 동그라미, 점수), 학생이 적은 답·풀이·낙서는 모두 빼고 인쇄된 문제만 옮겨요.
   - 문제 번호(예: "3.")는 빼요. 지문·자료·조건은 빠짐없이 옮겨요.
   - hasFigure: 그림·도형·그래프·표·지도처럼 글로 옮길 수 없는 자료가 있으면 true
   - answer와 explanation은 이 문제의 정답과 풀이예요.
3. unit: 이 문제의 세부 유형 이름 (짧게, 예: "일차방정식의 활용 - 거리·속력·시간")
4. chapter: 교과서 단원 이름 (예: "일차방정식", "현재완료", "광합성"). 같은 단원의 문제끼리 묶을 때 써요.
5. concept: 이 유형을 풀기 위한 핵심 개념
   - title: 개념 이름 / summary: 한두 문장 설명 / points: 꼭 알아야 할 원리·공식 2~4개
   - tip: 학생이 고른 틀린 이유를 고려한 실수 방지 팁 한 문장
6. problems: 원래 문제와 동일한 유형의 문제 3개
${SAME_TYPE}
7. bankUnitId: 아래 목록 중 이 문제와 가장 가까운 단원의 id, 없으면 null
${bankUnits.map((u) => `   - ${u.id}: ${u.title}`).join("\n")}

${FORMAT_HELP}
${STYLE}

JSON 형식:
{"readable":true,
 "original":{"type":"choice","question":"","choices":["","","","",""],"answer":0,"accept":[],"explanation":"","hasFigure":false},
 "unit":"","chapter":"",
 "concept":{"title":"","summary":"","points":[""],"tip":""},
 "problems":[{"type":"choice","question":"","choices":["","","","",""],"answer":0,"accept":[],"explanation":""}],
 "bankUnitId":null}`;

  const data = await run([prompt, { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }]);
  const original = cleanProblem(data.original);
  const problems = cleanList(data.problems);
  if (!data.readable || !original || problems.length < 3 || !data.concept) throw new Error("UNREADABLE");
  original.hasFigure = !!data.original.hasFigure;
  return {
    original,
    // 예전 화면 호환용 글자 정보
    problemText: original.question + (original.choices ? "\n" + original.choices.map((c, i) => `${"①②③④⑤"[i]} ${c}`).join("\n") : ""),
    correctAnswer: (original.type === "choice" ? `${"①②③④⑤"[original.answer]} ${original.choices[original.answer]}` : original.answer) + (original.explanation ? `\n${original.explanation}` : ""),
    unit: String(data.unit || ""),
    chapter: String(data.chapter || data.unit || ""),
    concept: {
      title: String(data.concept.title || ""), summary: String(data.concept.summary || ""),
      points: (data.concept.points || []).map(String), tip: String(data.concept.tip || ""),
    },
    problems: problems.slice(0, 3),
    bankUnitId: bankUnits.some((u) => u.id === data.bankUnitId) ? data.bankUnitId : null,
  };
}

/** 틀렸을 때 추가로 풀 동일 유형 문제 3개 */
export async function moreProblems({ note, grade, seen, wrongCount }) {
  const o = note.original;
  const originalText = o ? JSON.stringify({ type: o.type, question: o.question, choices: o.choices, answer: o.answer }) : note.problemText;
  const prompt = `당신은 ${grade} 학생의 ${SUBJECTS[note.subject].name} 선생님이에요.
학생이 아래 문제와 동일한 유형을 연습하다가 ${wrongCount}문제를 틀렸어요. 동일 유형 문제 3개를 새로 만들어 주세요.
- 원래 문제: ${originalText}
- 유형: ${note.unit}
- 핵심 개념: ${note.concept?.title} - ${note.concept?.summary}
- 이미 낸 문제(같은 숫자·보기는 쓰지 않아요): ${seen.slice(-9).join(" / ")}
${SAME_TYPE}

${FORMAT_HELP}
${STYLE}

JSON 형식: {"problems":[{"type":"","question":"","choices":[],"answer":0,"accept":[],"explanation":""}]}`;
  const data = await run([prompt]);
  const problems = cleanList(data.problems);
  if (problems.length < 1) throw new Error("NO_PROBLEMS");
  return problems.slice(0, 3);
}
