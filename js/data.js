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

// 과목마다 다른 "틀린 이유"
export const REASONS = {
  korean: [
    "지문을 끝까지 꼼꼼히 읽지 않았어요",
    "발문을 잘못 읽었어요 (옳은 것/옳지 않은 것)",
    "어휘·개념어 뜻을 몰랐어요",
    "작품 해석·주제 파악이 어려웠어요",
    "문법 개념이 헷갈렸어요",
    "선택지를 끝까지 비교하지 않았어요",
    "시간이 부족했어요",
  ],
  math: [
    "개념·공식을 몰랐어요",
    "계산 실수를 했어요",
    "문제 조건을 놓쳤어요",
    "풀이 방법이 떠오르지 않았어요",
    "부호·단위를 실수했어요",
    "그래프·도형 해석이 어려웠어요",
    "시간이 부족했어요",
  ],
  english: [
    "단어 뜻을 몰랐어요",
    "문법이 헷갈렸어요",
    "문장 구조(해석)가 어려웠어요",
    "글의 흐름·주제를 놓쳤어요",
    "철자를 틀렸어요",
    "선택지 함정에 빠졌어요",
    "시간이 부족했어요",
  ],
  social: [
    "개념·용어가 헷갈렸어요",
    "암기가 부족했어요",
    "자료(지도·그래프·표) 해석이 어려웠어요",
    "사건 순서·원인과 결과가 헷갈렸어요",
    "비슷한 개념을 구분하지 못했어요",
    "발문을 잘못 읽었어요",
    "시간이 부족했어요",
  ],
  science: [
    "개념·원리를 이해하지 못했어요",
    "공식·단위를 실수했어요",
    "실험 과정·변인 해석이 어려웠어요",
    "그래프·표 해석이 어려웠어요",
    "계산 실수를 했어요",
    "용어가 헷갈렸어요",
    "문제 조건을 놓쳤어요",
  ],
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
