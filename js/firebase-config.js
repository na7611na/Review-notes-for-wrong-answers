// ============================================================
//  Firebase 설정 파일
//  README의 "2단계"에서 Firebase 콘솔이 보여주는 firebaseConfig 값을
//  아래에 그대로 붙여넣으세요. (이 값은 공개되어도 괜찮은 값입니다.
//  데이터 보호는 Firestore 보안 규칙이 담당합니다.)
// ============================================================
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "000000000000",
  appId: "YOUR_APP_ID",
};

// 사용할 Gemini 모델 (앞에서부터 차례로 시도합니다).
// 모델이 종료(404)되면 다음 모델로 자동 전환됩니다.
// 새 모델이 나오면 맨 앞에 추가하세요.
export const AI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite"];
