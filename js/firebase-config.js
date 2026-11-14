// ============================================================
//  Firebase 설정 파일
//  README의 "2단계"에서 Firebase 콘솔이 보여주는 firebaseConfig 값을
//  아래에 그대로 붙여넣으세요. (이 값은 공개되어도 괜찮은 값입니다.
//  데이터 보호는 Firestore 보안 규칙이 담당합니다.)
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyCWxahZ3K-ihoi-9dPwsa7sfyuqgL3ARRA",
  authDomain: "review-notes-c9b70.firebaseapp.com",
  projectId: "review-notes-c9b70",
  storageBucket: "review-notes-c9b70.firebasestorage.app",
  messagingSenderId: "863047230299",
  appId: "1:863047230299:web:0d70813196a7810c3df07e"
};

// 사용할 Gemini 모델 (앞에서부터 차례로 시도합니다).
// 앞 모델이 실패하면(종료, 사용량 초과, 접속 몰림 등) 다음 모델로 자동 전환됩니다.
// 새 모델이 나오면 맨 앞에 추가하세요.
// gemini-3.8-flash는 요즘 접속이 몰려 응답이 늦어 맨 뒤에 둠
export const AI_MODELS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
