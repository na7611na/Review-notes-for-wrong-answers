// 과목, 학년, 틀린 이유, 메시지 등 앱 전체에서 쓰는 기본 데이터

export const SUBJECTS = {
  korean:  { name: "국어", icon: "📖", color: "var(--c-korean)",  soft: "var(--c-korean-soft)" },
  math:    { name: "수학", icon: "📐", color: "var(--c-math)",    soft: "var(--c-math-soft)" },
  english: { name: "영어", icon: "🔤", color: "var(--c-english)", soft: "var(--c-english-soft)" },
  social:  { name: "사회", icon: "🌏", color: "var(--c-social)",  soft: "var(--c-social-soft)" },
  science: { name: "과학", icon: "🔬", color: "var(--c-science)", soft: "var(--c-science-soft)" },
};
export const SUBJECT_KEYS = Object.keys(SUBJECTS);

export const GRADES = ["초5", "초6", "중1", "중2", "중3", "고1", "고2", "고3"];
export const BANDS = { elem: "초등", mid: "중학", high: "고등" };
export function bandOf(grade) {
  if (!grade) return "mid";
  if (grade.startsWith("초")) return "elem";
  if (grade.startsWith("중")) return "mid";
  return "high";
}

// 과목마다 다른 "틀린 이유" (핵심 용어로 짧게, "기타"는 화면에서 직접 입력)
export const REASONS = {
  korean: ["실수", "개념 부족", "어휘 부족", "지문 이해 부족", "문제 이해 부족", "적용·응용 실패"],
  math: ["실수", "개념 부족", "적용·응용 실패", "문제 이해 부족", "부호·단위 실수", "그래프·도형 해석 부족"],
  english: ["실수", "어휘 부족", "문법 부족", "구문 해석 부족", "문제 이해 부족", "글의 흐름 파악 부족"],
  social: ["실수", "개념 부족", "개념 혼동", "적용·응용 실패", "문제 이해 부족", "자료 해석 부족"],
  science: ["실수", "개념 부족", "적용·응용 실패", "문제 이해 부족", "공식·단위 실수", "실험·자료 해석 부족"],
};

// 틀렸을 때 보여주는 격려 메시지
export const ENCOURAGE = [
  "괜찮아요! 틀린 문제는 실력이 자라는 자리예요 🌱",
  "아깝다! 거의 다 왔어요. 한 번만 더 해볼까요? 💪",
  "실수는 배움의 일부예요. 해설을 읽고 다시 도전해요 ✨",
  "지금 틀린 덕분에 시험에선 맞힐 수 있어요 😊",
  "천천히 해도 괜찮아요. 꾸준함이 최고의 실력이에요 🐢",
  "포기하지 않는 모습이 정말 멋져요! 👏",
  "한 문제씩 쌓이면 큰 실력이 돼요. 계속 가 봐요 🚀",
];

// 모두 맞혔을 때 보여주는 칭찬 메시지
export const PRAISE = [
  "완벽해요! 이 유형은 이제 내 것이에요 🎉",
  "대단해요! 오답을 정복했어요 🏆",
  "최고예요! 이렇게 하나씩 정복하면 돼요 🌟",
  "멋져요! 노력이 실력이 되었어요 💯",
];

export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
