// ============================================================
//  Firebase 로그인(Auth) + 데이터베이스(Firestore)
//  저장 구조
//   users/{uid}                 : 프로필 { loginId, name, grade }
//   users/{uid}/notes/{noteId}  : 오답 기록 (작은 썸네일 포함)
//   users/{uid}/images/{noteId} : 원본 사진 (압축본, 상세 화면에서만 불러옴)
//   bank/{unitId}               : 부모님이 추가한 문제은행 단원 (가족 공용)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, orderBy, writeBatch,
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

export const isConfigured = !String(firebaseConfig.apiKey).startsWith("YOUR_");
export let app = null;
let auth = null, db = null;

if (isConfigured) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

// 아이디를 Firebase가 요구하는 이메일 형식으로 바꿔 저장 (실제 메일은 보내지 않음)
const toEmail = (id) => `${id.toLowerCase()}@ohdap-note.app`;
export const ID_RULE = /^[a-z0-9_]{4,20}$/;

export function watchAuth(cb) { return onAuthStateChanged(auth, cb); }
export function currentUid() { return auth?.currentUser?.uid; }

export async function login(id, pw) {
  await signInWithEmailAndPassword(auth, toEmail(id), pw);
}
export async function signup(id, pw, name, grade) {
  const cred = await createUserWithEmailAndPassword(auth, toEmail(id), pw);
  await setDoc(doc(db, "users", cred.user.uid), { loginId: id.toLowerCase(), name, grade, createdAt: Date.now() });
}
export const logout = () => signOut(auth);

export function authErrorMessage(e) {
  const code = e?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) return "아이디 또는 비밀번호가 맞지 않아요.";
  if (code.includes("email-already-in-use")) return "이미 사용 중인 아이디예요.";
  if (code.includes("weak-password")) return "비밀번호는 6자 이상이어야 해요.";
  if (code.includes("too-many-requests")) return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
  if (code.includes("network")) return "인터넷 연결을 확인해 주세요.";
  if (code.includes("operation-not-allowed")) return "Firebase에서 이메일/비밀번호 로그인을 켜 주세요. (README 3단계)";
  if (code.includes("unauthorized-domain")) return "Firebase 승인된 도메인에 이 사이트 주소를 추가해 주세요. (README 3단계)";
  return "문제가 생겼어요: " + (e?.message || code);
}

// ---------- 프로필
export async function getProfile(uid) {
  const s = await getDoc(doc(db, "users", uid));
  return s.exists() ? s.data() : null;
}
export const saveProfile = (uid, data) => setDoc(doc(db, "users", uid), data, { merge: true });

// ---------- 오답 기록
const notesCol = (uid) => collection(db, "users", uid, "notes");

export async function listNotes(uid) {
  const snap = await getDocs(query(notesCol(uid), orderBy("createdAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
export async function createNote(uid, note, image) {
  const ref = doc(notesCol(uid));
  const batch = writeBatch(db);
  batch.set(ref, note);
  batch.set(doc(db, "users", uid, "images", ref.id), { data: image });
  await batch.commit();
  return ref.id;
}
export const updateNote = (uid, id, data) => updateDoc(doc(db, "users", uid, "notes", id), data);
export async function deleteNote(uid, id) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "notes", id));
  batch.delete(doc(db, "users", uid, "images", id));
  await batch.commit();
}
export async function getImage(uid, id) {
  const s = await getDoc(doc(db, "users", uid, "images", id));
  return s.exists() ? s.data().data : null;
}

// ---------- 가족 공용 문제은행
export async function listCustomUnits() {
  try {
    const snap = await getDocs(collection(db, "bank"));
    return snap.docs.map((d) => ({ id: d.id, custom: true, ...d.data() }));
  } catch (e) { console.warn("문제은행 불러오기 실패", e); return []; }
}
export async function saveCustomUnit(unit) {
  const ref = unit.id ? doc(db, "bank", unit.id) : doc(collection(db, "bank"));
  const { id, custom, ...data } = unit;
  await setDoc(ref, data);
  return ref.id;
}
export const deleteCustomUnit = (id) => deleteDoc(doc(db, "bank", id));
