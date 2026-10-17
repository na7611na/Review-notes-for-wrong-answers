// ============================================================
//  AI(Gemini, Firebase AI Logic 무료 사용량) 연동
//  실패하면 null 대신 예외를 던지고, 화면 쪽에서 문제은행으로 대체합니다.
// ============================================================
import { getAI, getGenerativeModel, GoogleAIBackend } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import { AI_MODELS } from "./firebase-config.js";
import { SUBJECTS } from "./data.js";
import { shuffle } from "./bank.js";

let ai = null;
export function initAI(app) {
  try { ai = getAI(app, { backend: new GoogleAIBackend() }); } catch (e) { console.warn("AI 초기화 실패", e); ai = null; }
}

const STYLE = `
- 학생 눈높이에 맞춰 친근한 존댓말(~해요)로 써요.
- 수식은 LaTeX를 쓰지 말고 x², √2, ½, ×, ÷, ≤ 같은 유니코드 문자로 써요.
- 문제는 모두 4지선다이고, answer는 정답 보기의 번호(0~3)예요.
- 정답이 확실한 문제만 내고, 계산 문제는 정답을 직접 다시 검산해요.
- explanation에는 풀이 과정을 2~3문장으로 써요.`;

async function run(parts) {
  if (!ai) throw new Error("AI_UNAVAILABLE");
  let lastErr;
  for (const name of AI_MODELS) {
    try {
      const model = getGenerativeModel(ai, { model: name, generationConfig: { responseMimeType: "application/json", temperature: 0.7 } });
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

// AI 문제를 검증하고 보기 순서를 섞는다 (AI가 정답을 한쪽에 몰아 두는 경향 방지)
function cleanProblems(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && typeof p.question === "string" && Array.isArray(p.choices) && p.choices.length === 4
      && Number.isInteger(p.answer) && p.answer >= 0 && p.answer < 4)
    .map((p) => {
      const order = shuffle([0, 1, 2, 3]);
      return { question: p.question, choices: order.map((i) => String(p.choices[i])), answer: order.indexOf(p.answer), explanation: String(p.explanation || "") };
    });
}

/**
 * 틀린 문제 사진을 분석해 문제 내용, 단원, 핵심 개념, 유사문제 3개를 만든다.
 * @returns {{readable, problemText, correctAnswer, unit, concept, problems, bankUnitId}}
 */
export async function analyzeProblem({ imageBase64, subject, grade, reasons, memo, bankUnits }) {
  const prompt = `당신은 ${grade} 학생의 ${SUBJECTS[subject].name} 과목 오답노트를 도와주는 선생님이에요.
사진은 학생이 틀린 문제예요. 학생이 고른 틀린 이유: ${reasons.length ? reasons.join(", ") : "(선택 안 함)"}
학생 메모: ${memo || "(없음)"}

다음을 JSON으로 만들어 주세요.
1. readable: 사진에서 문제를 읽을 수 있으면 true, 아니면 false
2. problemText: 사진 속 문제를 그대로 옮겨 적기 (보기 포함, 너무 길면 핵심만)
3. correctAnswer: 이 문제의 정답과 짧은 풀이
4. unit: 이 문제의 단원/유형 이름 (짧게, 예: "일차방정식의 활용")
5. concept: 이 유형을 풀기 위한 핵심 개념
   - title: 개념 이름
   - summary: 한두 문장 설명
   - points: 꼭 알아야 할 원리·공식 2~4개
   - tip: 학생이 고른 틀린 이유를 고려한 실수 방지 팁 한 문장
6. problems: 원래 문제와 같은 유형·비슷한 난이도의 새 문제 3개 (숫자·소재를 바꿔서)
7. bankUnitId: 아래 목록 중 이 문제와 가장 가까운 단원의 id, 없으면 null
${bankUnits.map((u) => `   - ${u.id}: ${u.title}`).join("\n")}
${STYLE}

JSON 형식:
{"readable":true,"problemText":"","correctAnswer":"","unit":"","concept":{"title":"","summary":"","points":[""],"tip":""},"problems":[{"question":"","choices":["","","",""],"answer":0,"explanation":""}],"bankUnitId":null}`;

  const data = await run([prompt, { inlineData: { data: imageBase64, mimeType: "image/jpeg" } }]);
  const problems = cleanProblems(data.problems);
  if (!data.readable || problems.length < 3 || !data.concept) throw new Error("UNREADABLE");
  return {
    problemText: String(data.problemText || ""),
    correctAnswer: String(data.correctAnswer || ""),
    unit: String(data.unit || ""),
    concept: {
      title: String(data.concept.title || ""), summary: String(data.concept.summary || ""),
      points: (data.concept.points || []).map(String), tip: String(data.concept.tip || ""),
    },
    problems: problems.slice(0, 3),
    bankUnitId: bankUnits.some((u) => u.id === data.bankUnitId) ? data.bankUnitId : null,
  };
}

/** 틀렸을 때 추가로 풀 같은 유형의 새 문제 3개 */
export async function moreProblems({ note, grade, seen, wrongCount }) {
  const prompt = `당신은 ${grade} 학생의 ${SUBJECTS[note.subject].name} 선생님이에요.
학생이 아래 유형의 문제를 연습하다가 ${wrongCount}문제를 틀렸어요. 같은 유형의 새 문제 3개를 만들어 주세요.
- 단원/유형: ${note.unit}
- 원래 문제: ${note.problemText}
- 핵심 개념: ${note.concept?.title} - ${note.concept?.summary}
- 이미 낸 문제(겹치지 않게): ${seen.slice(-9).join(" / ")}
첫 문제는 개념을 확인하는 조금 쉬운 문제, 나머지 두 문제는 원래 문제와 비슷한 난이도로 내 주세요.
${STYLE}

JSON 형식: {"problems":[{"question":"","choices":["","","",""],"answer":0,"explanation":""}]}`;
  const data = await run([prompt]);
  const problems = cleanProblems(data.problems);
  if (problems.length < 1) throw new Error("NO_PROBLEMS");
  return problems.slice(0, 3);
}
