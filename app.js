/**
 * ============================================================================
 * 지속가능한 미래를 위한 2050 로봇 박람회 (app.js)
 * ============================================================================
 * - [탭 1] 🛠️ 로봇 설계실 (이름 로그인 비공개 개별 공간, 7단계 입력, 예시 태그, 실시간 코칭, 2종 자동 변환, 자동 이어쓰기)
 * - [탭 2] 🏛️ 미래 로봇 박람회 전시관 (부스 카드 갤러리, MP4/영상 링크 첨부, 좌우 분할 상세 모달)
 * - [탭 3] 🔒 교사 관리자 화면 (비밀번호 인증, 실시간 현황/필터, 상세 확인 및 수정, 피드백 수정 요청/전시 승인, 버전 이력 비교)
 * - 실시간 동기화: LocalStorage(0.1초 즉시 저장) + Supabase Realtime/DB & Storage(4초 자동 전송 + 단계 이동 시 즉시 전송) + GAS 보조 연동
 */

// ============================================================================
// 1. 상수 및 스토리지 키 설정
// ============================================================================
const STORAGE_KEYS = {
  STUDENTS_DB: 'robot_expo_2050_students_v2',
  INITIALIZED: 'robot_expo_2050_initialized_v2',
  CURRENT_STUDENT: 'robot_expo_2050_current_student_v2',
  LAST_TYPED_NAME: 'robot_expo_2050_last_name_v2',
  TEACHER_UNLOCKED: 'robot_expo_2050_teacher_unlocked_v2',
  TEACHER_PIN_HASH: 'robot_expo_2050_teacher_pin_hash_v2',
  GAS_WEB_APP_URL: 'robot_expo_2050_gas_url_v1',
  SUPABASE_URL: 'robot_expo_2050_supabase_url_v1',
  SUPABASE_ANON_KEY: 'robot_expo_2050_supabase_key_v1',
  DELETED_MAP: 'robot_expo_2050_deleted_map_v1',
};

// Supabase 기본 연결 설정 (교사 화면 [⚡ Supabase 설정]에서도 입력/저장 가능하며, 연결 시 모든 학생 기기에 자동 공유됨)
const DEFAULT_SUPABASE_URL = '';
const DEFAULT_SUPABASE_ANON_KEY = '';
const SUPABASE_TABLE = 'robot_expo_students';
const SUPABASE_VIDEO_BUCKET = 'robot-videos';

const DEFAULT_GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycby-EdAgehj2XvdBo5SztxbPYwjqssFOe7Pwh6mQQt7tG_-EGi3p_2kTRaX4Bjryw42k/exec';
// 관리자 비밀번호 SHA-256 해시값 (평문 노출 방지)
const DEFAULT_TEACHER_PIN_HASH = '3b4bee7de5f1464e59301f5cab582e9ada969bb1964a64a8dfa392c071480337';

// 타이핑 중 클라우드 자동 전송 간격: 4초 (로컬 스토리지는 0.1초 이내 즉시 저장, 단계 이동 시 즉시 전송)
const AUTO_SYNC_DEBOUNCE_MS = 4000;
const CLOUD_POLL_INTERVAL_MS = 12000;

// 상태 정의
const STATUS_META = {
  drafting: {
    key: 'drafting',
    label: '작성중',
    studentBadge: '✍️ 작성중',
    badgeClass: 'bg-slate-100 text-slate-700 border border-slate-300',
  },
  submitted: {
    key: 'submitted',
    label: '제출완료',
    studentBadge: '📩 제출완료 (교사 확인 대기)',
    badgeClass: 'bg-blue-100 text-blue-700 border border-blue-200',
  },
  revision: {
    key: 'revision',
    label: '수정요청',
    studentBadge: '🚨 수정요청 도착!',
    badgeClass: 'bg-orange-100 text-orange-800 border border-orange-300',
  },
  approved: {
    key: 'approved',
    label: '전시승인',
    studentBadge: '✅ 전시승인 완료!',
    badgeClass: 'bg-emerald-100 text-emerald-800 border border-emerald-300',
  },
};

// ============================================================================
// 2. 프롬프트 & 개조식 기획서 조합 함수 및 초기 더미 데이터
// ============================================================================
function parseCoreValuesHashtags(rawStr) {
  if (!rawStr) return [];
  const tokens = String(rawStr)
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const formatted = tokens.map((t) => (t.startsWith('#') ? t : `#${t}`));
  return Array.from(new Set(formatted));
}

function formatCoreValuesString(rawStr) {
  const tags = parseCoreValuesHashtags(rawStr);
  return tags.join(' ');
}

function cleanForVisualPrompt(str) {
  if (!str) return '';
  return String(str)
    .replace(/#/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.。]+$/, '');
}

function buildPromptFromInputs(inputs = {}) {
  const robotName = cleanForVisualPrompt(inputs.robotName) || '미래형 로봇';
  const appearance = cleanForVisualPrompt(inputs.appearance) || '미래지향적인 기계 구조';
  const purpose = cleanForVisualPrompt(inputs.purpose) || '미래 도시 현장';
  const mainFunction = cleanForVisualPrompt(inputs.mainFunction) || '정밀하게 작동하며 임무를 수행';
  const sensorName = cleanForVisualPrompt(inputs.sensorName) || '첨단 센서';
  const sensorTarget = cleanForVisualPrompt(inputs.sensorTarget) || '주변 목표물';
  const sensorAction = cleanForVisualPrompt(inputs.sensorAction) || '신속하게 이동하여 대응';
  const videoStyle = cleanForVisualPrompt(inputs.videoStyle) || '고화질 3D 애니메이션 스타일';

  return `[동영상 제작] ${purpose} 현장에서 ${appearance} 외형의 로봇 '${robotName}'이 역동적으로 움직이며 작동하는 영상. 로봇의 ${sensorName}가 빛나며 ${sensorTarget}을 스캔한 뒤, ${sensorAction}하며 ${mainFunction}하는 모습을 연속된 동작으로 생생하게 보여준다. 로봇의 기계 관절 움직임 클로즈업과 전신 작동 장면을 부드러운 카메라 워킹으로 담아낸 ${videoStyle} 동영상.`;
}

function buildSpecSheetFromInputs(inputs = {}) {
  return {
    robotAndAppearance: {
      title: '🤖 출품 로봇명 & 외형',
      robotName: (inputs.robotName || '미정').trim(),
      appearance: (inputs.appearance || '-').trim(),
    },
    purpose: {
      title: '🎯 개발 배경 및 목적',
      content: (inputs.purpose || '-').trim(),
    },
    mainFunction: {
      title: '⚙️ 핵심 작동 기능 및 구조',
      content: (inputs.mainFunction || '-').trim(),
    },
    sensorMechanism: {
      title: '📡 스마트 감지 메커니즘 (센서명 / 감지 대상 / 작동 연동)',
      sensorName: (inputs.sensorName || '-').trim(),
      sensorTarget: (inputs.sensorTarget || '-').trim(),
      sensorAction: (inputs.sensorAction || '-').trim(),
    },
    scienceTech: {
      title: '🔬 적용 융합 과학기술',
      content: (inputs.scienceTech || '-').trim(),
    },
    coreValues: {
      title: '💎 추구하는 핵심 가치',
      content: formatCoreValuesString(inputs.coreValues) || '-',
    },
    videoStyle: {
      title: '🎨 영상 연출 스타일',
      content: (inputs.videoStyle || '고화질 3D 애니메이션 스타일').trim(),
    },
  };
}

function getInitialDummyStudents() {
  return [];
}

const LEGACY_DUMMY_ROBOT_NAMES = new Set([
  '아쿠아 가디언 X-50',
  '바다 청소 로봇',
  '파이어 스파이더',
  '실버케어 버디 S2',
  '실버케어 버디',
  '에어퓨어 드론봇',
]);

function isLegacyDummyStudent(student) {
  if (!student) return false;
  const robotName = String(student.inputs?.robotName || '').trim();
  if (LEGACY_DUMMY_ROBOT_NAMES.has(robotName)) return true;
  const updatedAt = String(student.updatedAt || '');
  if (updatedAt.startsWith('2026-11-13T05:') || updatedAt === '2026-11-13T06:00:00.000Z' || updatedAt === '2026-11-13T06:02:00.000Z') {
    return true;
  }
  return false;
}

// ============================================================================
// 3. 전역 애플리케이션 상태
// ============================================================================
let state = {
  activeTab: 'studio',                // 'studio' | 'expo' | 'teacher'
  students: [],                       // 전체 학생 배열
  deletedMap: {},                     // 삭제된 학생 식별자/이름 -> 삭제 시각(ms)
  currentStudentId: null,             // [탭 1] 현재 로그인한 학생 식별자(이름)
  lastLocalStudentTypingAt: 0,        // 학생이 마지막으로 타이핑한 시각(ms) - 작성 중 덮어쓰기 방지
  expoFilter: 'all',                  // 'all' | 'approved' | 'video'
  teacherUnlocked: false,             // [탭 3] 교사 인증 여부
  teacherFilter: 'all',               // 'all' | 'drafting' | 'submitted' | 'revision' | 'approved'
  selectedTeacherStudentId: null,     // [탭 3] 우측 패널에 선택된 학생
  teacherRenderedStudentId: null,     // [탭 3] 우측 패널에 현재 렌더링된 학생 식별자
  teacherDetailDirty: false,          // [탭 3] 교사가 우측 상세 패널에서 수정 중인지 여부 (초기화 방지)
  activeBoothStudentId: null,         // [탭 2] 부스 상세 모달 학생
  videoAttachTargetId: null,          // 영상 첨부 모달 대상 학생
  videoModalTab: 'file',              // 'file' | 'url'
  pendingVideoFileData: null,         // 업로드 대기 중인 로컬 비디오 파일 객체
  supabaseUrl: '',                    // Supabase Project URL
  supabaseAnonKey: '',                // Supabase anon public key
  gasUrl: '',                         // Google Apps Script Web App URL (보조 백업)
  isSyncing: false,
  lastSyncedAt: null,
};

let supabaseClient = null;
let supabaseRealtimeChannel = null;

// 탭 간 실시간 통신 채널
const broadcastChannel = typeof BroadcastChannel !== 'undefined'
  ? new BroadcastChannel('robot_expo_2050_realtime_channel')
  : null;

if (broadcastChannel) {
  broadcastChannel.onmessage = (event) => {
    if (event.data && event.data.type === 'DB_UPDATED') {
      loadStudentsFromLocalStorage();
      refreshAllViews(false);
    }
  };
}

window.addEventListener('storage', (e) => {
  if (e.key === STORAGE_KEYS.STUDENTS_DB) {
    loadStudentsFromLocalStorage();
    refreshAllViews(false);
  }
});

// ============================================================================
// 4. IndexedDB (로컬 MP4 영상 파일 캐시 및 오프라인 백업 저장소)
// ============================================================================
const VIDEO_DB_NAME = 'RobotExpo2050VideoDB';
const VIDEO_STORE_NAME = 'videos';
const localVideoObjectUrls = {};

function openVideoIndexedDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const req = indexedDB.open(VIDEO_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(VIDEO_STORE_NAME)) {
        db.createObjectStore(VIDEO_STORE_NAME, { keyPath: 'studentId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveVideoBlobToIndexedDB(studentId, fileBlob, fileName) {
  try {
    const db = await openVideoIndexedDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readwrite');
      const store = tx.objectStore(VIDEO_STORE_NAME);
      store.put({
        studentId: String(studentId),
        blob: fileBlob,
        fileName: fileName || 'robot_video.mp4',
        savedAt: new Date().toISOString(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    if (localVideoObjectUrls[studentId]) {
      URL.revokeObjectURL(localVideoObjectUrls[studentId]);
    }
    localVideoObjectUrls[studentId] = URL.createObjectURL(fileBlob);
    return localVideoObjectUrls[studentId];
  } catch (err) {
    console.warn('IndexedDB 영상 저장 실패, ObjectURL 폴백 사용:', err);
    localVideoObjectUrls[studentId] = URL.createObjectURL(fileBlob);
    return localVideoObjectUrls[studentId];
  }
}

async function loadAllVideoBlobsFromIndexedDB() {
  try {
    const db = await openVideoIndexedDB();
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(VIDEO_STORE_NAME, 'readonly');
      const store = tx.objectStore(VIDEO_STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    records.forEach((rec) => {
      if (rec && rec.studentId && rec.blob) {
        if (localVideoObjectUrls[rec.studentId]) {
          URL.revokeObjectURL(localVideoObjectUrls[rec.studentId]);
        }
        localVideoObjectUrls[rec.studentId] = URL.createObjectURL(rec.blob);
      }
    });
  } catch (err) {
    console.warn('IndexedDB 로드 생략:', err);
  }
}

// ============================================================================
// 5. 초기화 및 데이터 로드 / Supabase 실시간 DB & Storage 연동
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  initStorageAndState();
  await loadAllVideoBlobsFromIndexedDB();
  bindFormEvents();
  refreshAllViews(true);

  initSupabaseClient();
  if (isCloudConfigured()) {
    pullFromCloudNow(true);
  }
  startRealtimeSyncLoop();
});

function loadDeletedMapFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DELETED_MAP);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        state.deletedMap = parsed;
        return;
      }
    }
  } catch (err) {
    console.warn('삭제 목록 로드 생략:', err);
  }
  state.deletedMap = {};
}

function saveDeletedMapToStorage() {
  try {
    localStorage.setItem(STORAGE_KEYS.DELETED_MAP, JSON.stringify(state.deletedMap || {}));
  } catch (err) {
    console.warn('삭제 목록 저장 생략:', err);
  }
}

function isStudentMarkedDeleted(student) {
  if (!student) return false;
  if (isLegacyDummyStudent(student)) return true;
  if (!state.deletedMap) return false;
  const idKey = String(student.studentId || '').trim();
  const nameKey = String(student.studentName || '').trim();
  const deletedAt = Math.max(Number(state.deletedMap[idKey] || 0), Number(state.deletedMap[nameKey] || 0));
  if (!deletedAt) return false;
  const studentTime = new Date(student.updatedAt || 0).getTime() || 0;
  return studentTime <= deletedAt;
}

function clearDeletedMark(idOrName) {
  const key = String(idOrName || '').trim();
  if (!key || !state.deletedMap) return;
  if (state.deletedMap[key]) {
    delete state.deletedMap[key];
    saveDeletedMapToStorage();
  }
}

function initStorageAndState() {
  loadDeletedMapFromStorage();
  const isInit = localStorage.getItem(STORAGE_KEYS.INITIALIZED);
  const rawDb = localStorage.getItem(STORAGE_KEYS.STUDENTS_DB);

  if (!isInit || rawDb === null) {
    const dummy = getInitialDummyStudents();
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
    localStorage.setItem(STORAGE_KEYS.STUDENTS_DB, JSON.stringify(dummy));
    state.students = dummy;
  } else {
    loadStudentsFromLocalStorage();
  }

  // 사이트를 새로 열었을 때도 이전에 작업하던 학생 세션 및 작성 내용을 즉시 이어서 복원
  const savedStudentId = (localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT) || '').trim();
  if (savedStudentId) {
    const found = findStudentByIdOrName(savedStudentId);
    if (found) {
      state.currentStudentId = found.studentId;
    } else {
      // 로컬 배열에서 누락되었더라도 세션이 존재하면 빈 학생 객체를 즉시 복원하여 튕김 방지
      const restored = createEmptyStudentObject(savedStudentId);
      state.students.push(restored);
      state.currentStudentId = restored.studentId;
      saveStudentsToLocalStorage(false);
    }
  }

  // 마지막에 입력했던 이름을 로그인 입력창에 미리 채워두기
  const lastTypedName = localStorage.getItem(STORAGE_KEYS.LAST_TYPED_NAME);
  const loginNameInput = document.getElementById('login-student-name');
  if (loginNameInput && lastTypedName && findStudentByIdOrName(lastTypedName)) {
    loginNameInput.value = lastTypedName;
  } else if (lastTypedName && !findStudentByIdOrName(lastTypedName)) {
    localStorage.removeItem(STORAGE_KEYS.LAST_TYPED_NAME);
  }

  // 교사 잠금 해제 상태 복원
  state.teacherUnlocked = sessionStorage.getItem(STORAGE_KEYS.TEACHER_UNLOCKED) === 'true';

  // Supabase URL & Key 복원
  const savedSbUrl = (localStorage.getItem(STORAGE_KEYS.SUPABASE_URL) || '').trim();
  const savedSbKey = (localStorage.getItem(STORAGE_KEYS.SUPABASE_ANON_KEY) || '').trim();
  state.supabaseUrl = savedSbUrl || DEFAULT_SUPABASE_URL;
  state.supabaseAnonKey = savedSbKey || DEFAULT_SUPABASE_ANON_KEY;

  // GAS URL 기본값 자동 설정
  const savedGasUrl = (localStorage.getItem(STORAGE_KEYS.GAS_WEB_APP_URL) || '').trim();
  state.gasUrl = savedGasUrl || DEFAULT_GAS_WEB_APP_URL;
  if (!savedGasUrl && DEFAULT_GAS_WEB_APP_URL) {
    localStorage.setItem(STORAGE_KEYS.GAS_WEB_APP_URL, DEFAULT_GAS_WEB_APP_URL);
  }
  updateSyncStatusHeader();
}

function createEmptyStudentObject(studentName) {
  const cleanName = String(studentName || '').trim();
  return {
    studentId: cleanName,
    studentName: cleanName,
    status: 'drafting',
    inputs: {
      robotName: '',
      appearance: '',
      purpose: '',
      mainFunction: '',
      sensorName: '',
      sensorTarget: '',
      sensorAction: '',
      scienceTech: '',
      coreValues: '',
      videoStyle: '',
    },
    videoPrompt: '',
    specSheet: null,
    teacherFeedback: '',
    feedbackAt: '',
    video: { type: 'none', url: '', title: '' },
    likes: 0,
    currentVersion: 0,
    history: [],
    updatedAt: new Date().toISOString(),
  };
}

function loadStudentsFromLocalStorage() {
  loadDeletedMapFromStorage();
  const currentId = state.currentStudentId || (localStorage.getItem(STORAGE_KEYS.CURRENT_STUDENT) || '').trim();
  const currentActiveStudentSnapshot = currentId ? findStudentById(currentId) : null;

  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STUDENTS_DB);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        let upgraded = false;
        const filtered = parsed.filter((st) => {
          // 현재 로그인해 작성 중인 학생은 어떤 경우에도 삭제 필터로 지우지 않음
          const stKey = String(st?.studentId || st?.studentName || '').trim();
          if (currentId && stKey === currentId) return true;
          if (isStudentMarkedDeleted(st)) {
            upgraded = true;
            return false;
          }
          return true;
        });
        filtered.forEach((st) => {
          if (st && st.inputs && st.videoPrompt && !st.videoPrompt.startsWith('[동영상 제작]')) {
            st.videoPrompt = buildPromptFromInputs(st.inputs);
            upgraded = true;
          }
          if (st?.video?.type === 'sample') {
            st.video = { type: 'none', url: '', title: '' };
            upgraded = true;
          }
          if (Array.isArray(st?.history)) {
            st.history.forEach((h) => {
              if (h && h.inputs && h.videoPrompt && !h.videoPrompt.startsWith('[동영상 제작]')) {
                h.videoPrompt = buildPromptFromInputs(h.inputs);
                upgraded = true;
              }
            });
          }
        });

        // 만약 다른 탭/스토리지 이벤트로 인해 현재 로그인한 학생이 목록에서 빠졌다면 즉시 복원
        if (currentId && !filtered.some((s) => s.studentId === currentId || s.studentName === currentId)) {
          filtered.push(currentActiveStudentSnapshot || createEmptyStudentObject(currentId));
        }

        state.students = filtered;
        if (upgraded) {
          localStorage.setItem(STORAGE_KEYS.STUDENTS_DB, JSON.stringify(filtered));
        }
        return;
      }
    }
  } catch (err) {
    console.error('LocalStorage 파싱 오류:', err);
  }
  if (currentActiveStudentSnapshot) {
    state.students = [currentActiveStudentSnapshot];
  } else {
    state.students = [];
  }
}

function saveStudentsToLocalStorage(notifyTabs = true) {
  try {
    localStorage.setItem(STORAGE_KEYS.INITIALIZED, 'true');
    localStorage.setItem(STORAGE_KEYS.STUDENTS_DB, JSON.stringify(state.students));
    if (notifyTabs && broadcastChannel) {
      broadcastChannel.postMessage({ type: 'DB_UPDATED', timestamp: Date.now() });
    }
  } catch (err) {
    console.error('LocalStorage 저장 오류:', err);
  }
}

function findStudentById(studentId) {
  if (!studentId) return null;
  const target = String(studentId).trim();
  return state.students.find(
    (s) => String(s.studentId).trim() === target || String(s.studentName).trim() === target
  ) || null;
}

function findStudentByIdOrName(query) {
  return findStudentById(query);
}

// ============================================================================
// 5-2. Supabase & Cloud 연동 헬퍼
// ============================================================================
function isSupabaseConfigured() {
  return Boolean(
    state.supabaseUrl &&
    state.supabaseUrl.startsWith('https://') &&
    state.supabaseUrl.includes('.supabase.co') &&
    state.supabaseAnonKey &&
    state.supabaseAnonKey.length > 20
  );
}

function isGasConfigured() {
  return Boolean(
    state.gasUrl &&
    state.gasUrl.startsWith('https://script.google.com/macros/s/')
  );
}

function isCloudConfigured() {
  return isSupabaseConfigured() || isGasConfigured();
}

function initSupabaseClient() {
  if (!isSupabaseConfigured()) {
    supabaseClient = null;
    if (supabaseRealtimeChannel) {
      try {
        supabaseRealtimeChannel.unsubscribe();
      } catch {
        // ignore
      }
      supabaseRealtimeChannel = null;
    }
    updateSyncStatusHeader();
    return null;
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    console.warn('Supabase SDK가 아직 로드되지 않았습니다.');
    return null;
  }

  try {
    supabaseClient = window.supabase.createClient(state.supabaseUrl, state.supabaseAnonKey, {
      auth: { persistSession: false },
    });
    subscribeSupabaseRealtime();
    updateSyncStatusHeader();
    return supabaseClient;
  } catch (err) {
    console.error('Supabase 클라이언트 초기화 실패:', err);
    supabaseClient = null;
    return null;
  }
}

function studentToSupabaseRow(student) {
  const nameVal = String(student.studentName || student.studentId || '').trim();
  const idVal = String(student.studentId || nameVal).trim();
  return {
    student_id: idVal,
    student_name: nameVal,
    status: String(student.status || 'drafting'),
    inputs: student.inputs || {},
    video_prompt: String(student.videoPrompt || ''),
    spec_sheet: student.specSheet || null,
    teacher_feedback: String(student.teacherFeedback || ''),
    feedback_at: String(student.feedbackAt || ''),
    video: student.video || { type: 'none', url: '', title: '' },
    likes: Number(student.likes) || 0,
    current_version: Number(student.currentVersion) || 0,
    history: Array.isArray(student.history) ? student.history : [],
    updated_at: student.updatedAt || new Date().toISOString(),
  };
}

function supabaseRowToStudent(row) {
  if (!row) return null;
  const nameVal = String(row.student_name || row.student_id || '').trim();
  const idVal = String(row.student_id || nameVal).trim();
  if (!idVal) return null;

  const rawInputs = row.inputs && typeof row.inputs === 'object' ? row.inputs : {};
  const rawVideo = row.video && typeof row.video === 'object' ? row.video : { type: 'none', url: '', title: '' };

  return {
    studentId: idVal,
    studentName: nameVal,
    status: String(row.status || 'drafting').trim(),
    inputs: {
      robotName: String(rawInputs.robotName || ''),
      appearance: String(rawInputs.appearance || ''),
      purpose: String(rawInputs.purpose || ''),
      mainFunction: String(rawInputs.mainFunction || ''),
      sensorName: String(rawInputs.sensorName || ''),
      sensorTarget: String(rawInputs.sensorTarget || ''),
      sensorAction: String(rawInputs.sensorAction || ''),
      scienceTech: String(rawInputs.scienceTech || ''),
      coreValues: String(rawInputs.coreValues || ''),
      videoStyle: String(rawInputs.videoStyle || ''),
    },
    videoPrompt: String(row.video_prompt || ''),
    specSheet: row.spec_sheet || null,
    teacherFeedback: String(row.teacher_feedback || ''),
    feedbackAt: String(row.feedback_at || ''),
    video: {
      type: String(rawVideo.type || 'none'),
      url: String(rawVideo.url || ''),
      title: String(rawVideo.title || ''),
    },
    likes: Number(row.likes) || 0,
    currentVersion: Number(row.current_version) || 0,
    history: Array.isArray(row.history) ? row.history : [],
    updatedAt: String(row.updated_at || new Date().toISOString()),
  };
}

function subscribeSupabaseRealtime() {
  if (!supabaseClient) return;
  if (supabaseRealtimeChannel) {
    try {
      supabaseRealtimeChannel.unsubscribe();
    } catch {
      // ignore
    }
    supabaseRealtimeChannel = null;
  }

  try {
    supabaseRealtimeChannel = supabaseClient
      .channel('robot_expo_students_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: SUPABASE_TABLE },
        (payload) => {
          handleSupabaseRealtimePayload(payload);
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('Supabase Realtime 구독 생략:', err);
  }
}

function handleSupabaseRealtimePayload(payload) {
  if (!payload) return;

  if (payload.eventType === 'DELETE') {
    const deletedId = String(payload.old?.student_id || '').trim();
    if (!deletedId) return;
    // 현재 로그인하여 작성 중인 학생 본인은 절대 강제 삭제하거나 튕기지 않음
    if (state.currentStudentId && (state.currentStudentId === deletedId)) {
      return;
    }
    state.students = state.students.filter(
      (s) => s.studentId !== deletedId && s.studentName !== deletedId
    );
    saveStudentsToLocalStorage(false);
    refreshAllViews(false);
    return;
  }

  if (payload.new) {
    const remStudent = supabaseRowToStudent(payload.new);
    if (!remStudent || isStudentMarkedDeleted(remStudent)) return;
    mergeSingleRemoteStudent(remStudent);
    saveStudentsToLocalStorage(false);
    refreshAllViews(false);
  }
}

// 상단 동기화 표시기 업데이트
function updateSyncStatusHeader(customMessage) {
  const dot = document.getElementById('sync-status-dot');
  const text = document.getElementById('sync-status-text');
  if (!dot || !text) return;

  if (customMessage) {
    dot.className = 'w-2 h-2 rounded-full bg-blue-500 animate-ping';
    text.textContent = customMessage;
    return;
  }

  if (isSupabaseConfigured()) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    text.textContent = 'Supabase 실시간 동기화 중';
  } else if (isGasConfigured()) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    text.textContent = '실시간 동기화 중';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-500';
    text.textContent = '로컬 실시간 동기화 중';
  }
}

// 단일 학생 변경사항만 개별 행(Row)으로 클라우드(Supabase + GAS 백업)에 비동기 전송 (절대 전체 삭제 안 함)
async function syncStudentToCloud(student, newVersionEntry = null) {
  if (!student) return;
  if (!isCloudConfigured()) return;

  try {
    updateSyncStatusHeader('실시간 저장 중...');

    // 1) Supabase 개별 행 Upsert
    if (isSupabaseConfigured()) {
      if (!supabaseClient) initSupabaseClient();
      if (supabaseClient) {
        const row = studentToSupabaseRow(student);
        const { error } = await supabaseClient
          .from(SUPABASE_TABLE)
          .upsert(row, { onConflict: 'student_id' });
        if (error) {
          console.warn('Supabase 개별 학생 저장 경고:', error.message);
        } else {
          state.lastSyncedAt = new Date().toISOString();
        }
      }
    }

    // 2) GAS 보조 백업이 설정되어 있으면 개별 행 Upsert 전송 (History_Log 누적 포함)
    if (isGasConfigured()) {
      const res = await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'upsert_student',
          student,
          newVersionEntry,
        }),
      });
      if (res.ok) {
        state.lastSyncedAt = new Date().toISOString();
      }
    }

    const indicator = document.getElementById('workspace-autosave-indicator');
    if (indicator && state.currentStudentId === student.studentId) {
      indicator.textContent = '☁️ 실시간 저장 완료 (' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ')';
    }
  } catch (err) {
    console.warn('클라우드 개별 학생 동기화 지연 (기기에 안전히 저장됨):', err);
  } finally {
    updateSyncStatusHeader();
  }
}

// 기존 호출부 호환용 별칭
async function syncStudentToGas(student, newVersionEntry = null) {
  return syncStudentToCloud(student, newVersionEntry);
}

// 클라우드(Supabase 우선, 미설정 시 GAS)에서 전체 학생 목록을 불러와 안전하게 병합 (절대 sync_all 호출 안 함)
async function pullFromCloudNow(silent = false) {
  if (!isCloudConfigured()) {
    if (!silent) showToast('먼저 Supabase 연결 정보를 설정해 주세요.', 'warning');
    return false;
  }
  if (state.isSyncing) return false;
  state.isSyncing = true;

  try {
    if (!silent) updateSyncStatusHeader('실시간 동기화 중...');

    let fetchedStudents = null;

    // 1) Supabase가 설정되어 있으면 Supabase에서 조회
    if (isSupabaseConfigured()) {
      if (!supabaseClient) initSupabaseClient();
      if (supabaseClient) {
        const { data, error } = await supabaseClient
          .from(SUPABASE_TABLE)
          .select('*')
          .order('updated_at', { ascending: true });

        if (error) throw new Error(error.message);
        if (Array.isArray(data)) {
          fetchedStudents = data.map(supabaseRowToStudent).filter(Boolean);
        }
      }
    }

    // 2) Supabase가 아직 설정되지 않았거나 GAS에서 Supabase 공유 설정을 받아올 때
    if (isGasConfigured() && (!isSupabaseConfigured() || fetchedStudents === null)) {
      const res = await fetch(`${state.gasUrl}?t=${Date.now()}`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();

      // 교사가 설정해 둔 Supabase 연결 정보가 있으면 학생 기기에도 자동으로 적용!
      if (
        result.supabaseConfig &&
        result.supabaseConfig.supabaseUrl &&
        result.supabaseConfig.supabaseAnonKey &&
        !isSupabaseConfigured()
      ) {
        state.supabaseUrl = String(result.supabaseConfig.supabaseUrl).trim();
        state.supabaseAnonKey = String(result.supabaseConfig.supabaseAnonKey).trim();
        localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, state.supabaseUrl);
        localStorage.setItem(STORAGE_KEYS.SUPABASE_ANON_KEY, state.supabaseAnonKey);
        initSupabaseClient();
        // 이제 Supabase에서 다시 데이터 로드
        if (supabaseClient) {
          const { data, error } = await supabaseClient
            .from(SUPABASE_TABLE)
            .select('*')
            .order('updated_at', { ascending: true });
          if (!error && Array.isArray(data)) {
            fetchedStudents = data.map(supabaseRowToStudent).filter(Boolean);
          }
        }
      }

      if (fetchedStudents === null) {
        const isSuccess = result.success === true || result.ok === true;
        if (!isSuccess || !Array.isArray(result.students)) {
          throw new Error(result.error || '응답 데이터 형식 오류');
        }
        fetchedStudents = result.students;
      }
    }

    if (Array.isArray(fetchedStudents)) {
      const deletedRemoteIds = mergeRemoteStudents(fetchedStudents);
      state.lastSyncedAt = new Date().toISOString();
      saveStudentsToLocalStorage(false);
      refreshAllViews(false);

      // 삭제 기록(Tombstone)이나 초기 더미(김미래)가 원격에 남아있으면 전체 덮어쓰기(sync_all) 대신 해당 ID만 개별 삭제
      if (deletedRemoteIds.length > 0) {
        for (const delId of deletedRemoteIds) {
          deleteStudentFromCloud(delId, true);
        }
      }
    }

    if (!silent) {
      showToast('⚡ 최신 학생 데이터를 실시간 동기화했습니다!', 'success');
    }
    return true;
  } catch (err) {
    console.warn('클라우드 데이터 가져오기 지연:', err);
    if (!silent) {
      showToast(`동기화 확인 필요: ${err.message}`, 'error');
    }
    return false;
  } finally {
    state.isSyncing = false;
    updateSyncStatusHeader();
  }
}

async function pullFromGasNow(silent = false) {
  return pullFromCloudNow(silent);
}

// 단일 원격 학생 병합 (작성 중 학생 보호 & 관리자 수정 중 보호)
function mergeSingleRemoteStudent(rem) {
  if (!rem) return;
  const key = String(rem.studentName || rem.studentId || '').trim();
  if (!key || isStudentMarkedDeleted(rem)) return;

  const idx = state.students.findIndex(
    (s) => String(s.studentName || s.studentId).trim() === key
  );

  if (idx === -1) {
    state.students.push(rem);
    return;
  }

  const loc = state.students[idx];
  const remTime = new Date(rem.updatedAt || 0).getTime() || 0;
  const locTime = new Date(loc.updatedAt || 0).getTime() || 0;

  const isCurrentActiveStudent =
    state.currentStudentId &&
    (state.currentStudentId === loc.studentId || state.currentStudentId === loc.studentName);

  // 현재 이 기기에서 로그인해 작성 중인 학생인 경우:
  // 학생이 작성 중인 입력값(inputs, videoPrompt, specSheet)은 절대 원격의 이전 데이터로 덮어쓰지 않고 보호!
  // 단, 선생님이 보낸 피드백(status, teacherFeedback, feedbackAt)이나 응원수(likes)는 실시간으로 반영
  if (isCurrentActiveStudent && state.activeTab === 'studio') {
    const isActivelyTyping = Date.now() - (state.lastLocalStudentTypingAt || 0) < 8000;
    if (isActivelyTyping || locTime >= remTime) {
      state.students[idx] = {
        ...loc,
        status: remTime >= locTime ? rem.status : loc.status,
        teacherFeedback: remTime >= locTime ? rem.teacherFeedback : loc.teacherFeedback,
        feedbackAt: remTime >= locTime ? rem.feedbackAt : loc.feedbackAt,
        likes: Math.max(Number(loc.likes) || 0, Number(rem.likes) || 0),
      };
      return;
    }
    // 학생이 타이핑을 멈춘 상태에서 선생님이 직접 학생 내용을 수정해 더 최신 시간(remTime > locTime)으로 보낸 경우
    state.students[idx] = {
      ...rem,
      inputs: remTime > locTime ? rem.inputs : loc.inputs,
    };
    return;
  }

  if (remTime >= locTime) {
    state.students[idx] = rem;
  }
}

// 전체 원격 학생 목록과 로컬 목록 병합 (작성 중인 학생 및 로컬 데이터 100% 보호)
function mergeRemoteStudents(remoteList) {
  loadDeletedMapFromStorage();

  const localMap = {};
  state.students.forEach((s) => {
    const key = String(s.studentName || s.studentId).trim();
    if (key) localMap[key] = s;
  });

  const merged = [];
  const seenKeys = new Set();
  const deletedRemoteIds = [];

  remoteList.forEach((rem) => {
    const key = String(rem.studentName || rem.studentId || '').trim();
    if (!key) return;

    const isCurrentActiveStudent =
      state.currentStudentId &&
      (state.currentStudentId === rem.studentId || state.currentStudentId === rem.studentName);

    // 삭제 기록(Tombstone)에 있는 학생이면 복구하지 않고 개별 삭제 대상에 추가 (단, 현재 로그인 중인 학생은 제외)
    if (!isCurrentActiveStudent && isStudentMarkedDeleted(rem)) {
      deletedRemoteIds.push(key);
      return;
    }

    seenKeys.add(key);

    const loc = localMap[key];
    if (!loc) {
      merged.push(rem);
      return;
    }

    const remTime = new Date(rem.updatedAt || 0).getTime() || 0;
    const locTime = new Date(loc.updatedAt || 0).getTime() || 0;

    if (isCurrentActiveStudent && state.activeTab === 'studio') {
      const isActivelyTyping = Date.now() - (state.lastLocalStudentTypingAt || 0) < 8000;
      if (isActivelyTyping || locTime >= remTime) {
        merged.push({
          ...loc,
          status: remTime >= locTime ? rem.status : loc.status,
          teacherFeedback: remTime >= locTime ? rem.teacherFeedback : loc.teacherFeedback,
          feedbackAt: remTime >= locTime ? rem.feedbackAt : loc.feedbackAt,
          likes: Math.max(Number(loc.likes) || 0, Number(rem.likes) || 0),
        });
      } else {
        merged.push(rem);
      }
      return;
    }

    if (remTime >= locTime) {
      merged.push(rem);
    } else {
      merged.push(loc);
    }
  });

  // 로컬에만 있고 원격에 아직 없는 학생:
  // 관리자가 명시적으로 삭제(isStudentMarkedDeleted)한 경우가 아니라면 절대 로컬에서 지우지 않고 보존!
  // 특히 현재 로그인해 작성 중인 학생(state.currentStudentId)은 100% 유지하여 로그인 화면 튕김을 원천 차단!
  state.students.forEach((loc) => {
    const key = String(loc.studentName || loc.studentId).trim();
    if (!key || seenKeys.has(key)) return;

    const isCurrentActiveStudent =
      state.currentStudentId &&
      (state.currentStudentId === loc.studentId || state.currentStudentId === loc.studentName);

    if (isCurrentActiveStudent || !isStudentMarkedDeleted(loc)) {
      merged.push(loc);
    }
  });

  state.students = merged;
  return deletedRemoteIds;
}

// 전체 덮어쓰기(clearContents) 없이 로컬의 학생들을 개별 행으로 안전하게 병합 업로드
async function pushAllLocalToGas(silent = false) {
  if (!isCloudConfigured()) {
    if (!silent) showToast('먼저 Supabase 또는 클라우드 연결을 설정해 주세요.', 'warning');
    return false;
  }
  try {
    updateSyncStatusHeader('개별 안전 병합 중...');
    const validStudents = state.students.filter((s) => !isStudentMarkedDeleted(s));

    if (isSupabaseConfigured()) {
      if (!supabaseClient) initSupabaseClient();
      if (supabaseClient && validStudents.length > 0) {
        const rows = validStudents.map(studentToSupabaseRow);
        const { error } = await supabaseClient
          .from(SUPABASE_TABLE)
          .upsert(rows, { onConflict: 'student_id' });
        if (error) throw new Error(error.message);
      }
    }

    if (isGasConfigured()) {
      for (const st of validStudents) {
        await fetch(state.gasUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'upsert_student',
            student: st,
          }),
        });
      }
    }

    state.lastSyncedAt = new Date().toISOString();
    updateSyncStatusHeader();
    if (!silent) {
      showToast(`⬆️ 학생 ${validStudents.length}명의 데이터를 삭제 없이 안전하게 병합 업로드했습니다!`, 'success');
    }
    return true;
  } catch (err) {
    updateSyncStatusHeader();
    if (!silent) {
      showToast(`데이터 업로드 오류: ${err.message}`, 'error');
    }
    return false;
  }
}

function startRealtimeSyncLoop() {
  setInterval(() => {
    if (document.visibilityState === 'visible' && isCloudConfigured()) {
      pullFromCloudNow(true);
    }
  }, CLOUD_POLL_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && isCloudConfigured()) {
      pullFromCloudNow(true);
    }
  });
}

function manualSyncNow() {
  if (isCloudConfigured()) {
    pullFromCloudNow(false);
  } else {
    loadStudentsFromLocalStorage();
    refreshAllViews(true);
    showToast('💾 로컬 스토리지 최신 상태로 동기화되었습니다.', 'info');
  }
}

// ============================================================================
// 6. 메인 탭 전환, 오른쪽 상단 홈화면 이동 & 전체 화면 리프레시
// ============================================================================
function switchMainTab(tabName) {
  state.activeTab = tabName;

  const tabs = ['studio', 'expo', 'teacher'];
  tabs.forEach((t) => {
    const viewEl = document.getElementById(`view-${t}`);
    const btnEl = document.getElementById(`tab-btn-${t}`);
    if (viewEl) {
      viewEl.classList.toggle('hidden', t !== tabName);
    }
    if (btnEl) {
      if (t === tabName) {
        btnEl.className = 'tab-nav-btn flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap bg-white text-blue-600 shadow-sm';
      } else {
        btnEl.className = 'tab-nav-btn flex-1 md:flex-initial flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all whitespace-nowrap text-slate-600 hover:text-slate-900';
      }
    }
  });

  refreshAllViews(false);
}

// 오른쪽 상단 [🏠 홈화면] 버튼: 로그인 화면으로 돌아가기 (작성 데이터는 안전하게 보존됨)
function goHomeToLogin() {
  // 현재 입력 중인 내용이 있으면 먼저 안전하게 저장
  const currentStudent = findStudentById(state.currentStudentId);
  if (currentStudent && state.activeTab === 'studio') {
    currentStudent.inputs = getStudioFormInputs();
    currentStudent.updatedAt = new Date().toISOString();
    saveStudentsToLocalStorage();
  }

  state.currentStudentId = null;
  localStorage.removeItem(STORAGE_KEYS.CURRENT_STUDENT);

  const resultsEl = document.getElementById('generated-results-section');
  if (resultsEl) resultsEl.classList.add('hidden');

  switchMainTab('studio');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('🏠 로그인 화면(홈)으로 이동했습니다. 이름을 입력하면 작성하던 내용을 이어서 볼 수 있어요!', 'info');
}

function refreshAllViews(populateInputs = false) {
  updateTopNavBadges();
  renderStudioWorkspace(populateInputs);
  renderExpoBooths();
  renderTeacherSection();
  updateSyncStatusHeader();
}

function updateTopNavBadges() {
  const studioBadge = document.getElementById('tab-studio-badge');
  const currentStudent = findStudentById(state.currentStudentId);
  if (studioBadge) {
    if (currentStudent && currentStudent.status === 'revision') {
      studioBadge.classList.remove('hidden');
      studioBadge.textContent = '수정요청!';
    } else {
      studioBadge.classList.add('hidden');
    }
  }

  const expoStudents = getExpoEligibleStudents();
  const expoCountEl = document.getElementById('tab-expo-count');
  if (expoCountEl) {
    expoCountEl.textContent = String(expoStudents.length);
  }

  const submittedCount = state.students.filter((s) => s.status === 'submitted').length;
  const teacherBadge = document.getElementById('tab-teacher-badge');
  if (teacherBadge) {
    if (submittedCount > 0) {
      teacherBadge.textContent = `검토 ${submittedCount}`;
      teacherBadge.className = 'px-2 py-0.5 text-xs rounded-full bg-amber-100 text-amber-800 font-extrabold';
    } else {
      teacherBadge.textContent = `${state.students.length}명`;
      teacherBadge.className = 'px-2 py-0.5 text-xs rounded-full bg-slate-200 text-slate-700 font-bold';
    }
  }
}

// ============================================================================
// 7. [탭 1] 🛠️ 로봇 설계실 (이름 로그인, 7단계 폼, 실시간 코칭, 2종 변환, 제출)
// ============================================================================
function sha256HexSync(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j;
  let result = '';
  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - (i % 4)) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;
  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

function bindFormEvents() {
  const loginForm = document.getElementById('student-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('login-student-name');
      const studentName = (nameInput?.value || '').trim();
      if (!studentName) {
        showToast('이름을 입력해 주세요!', 'warning');
        return;
      }
      loginAsStudent(studentName);
    });
  }

  const teacherAuthForm = document.getElementById('teacher-auth-form');
  if (teacherAuthForm) {
    teacherAuthForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pwInput = document.getElementById('teacher-password-input');
      const errEl = document.getElementById('teacher-auth-error');
      const savedPinHash = localStorage.getItem(STORAGE_KEYS.TEACHER_PIN_HASH) || DEFAULT_TEACHER_PIN_HASH;
      const inputHash = sha256HexSync((pwInput.value || '').trim());

      if (inputHash && inputHash === savedPinHash) {
        state.teacherUnlocked = true;
        sessionStorage.setItem(STORAGE_KEYS.TEACHER_UNLOCKED, 'true');
        pwInput.value = '';
        if (errEl) errEl.classList.add('hidden');
        renderTeacherSection();
        showToast('🔓 교사 관리자 화면 잠금이 해제되었습니다.', 'success');
      } else {
        if (errEl) errEl.classList.remove('hidden');
        showToast('비밀번호가 일치하지 않습니다.', 'error');
      }
    });
  }
}

function loginAsStudent(studentName) {
  const cleanName = String(studentName || '').trim();
  if (!cleanName) return;

  clearDeletedMark(cleanName);

  let student = findStudentByIdOrName(cleanName);
  if (!student) {
    student = {
      studentId: cleanName,
      studentName: cleanName,
      status: 'drafting',
      inputs: {
        robotName: '',
        appearance: '',
        purpose: '',
        mainFunction: '',
        sensorName: '',
        sensorTarget: '',
        sensorAction: '',
        scienceTech: '',
        coreValues: '',
        videoStyle: '',
      },
      videoPrompt: '',
      specSheet: null,
      teacherFeedback: '',
      feedbackAt: '',
      video: { type: 'none', url: '', title: '' },
      likes: 0,
      currentVersion: 0,
      history: [],
      updatedAt: new Date().toISOString(),
    };
    state.students.push(student);
    saveStudentsToLocalStorage();
    syncStudentToGas(student);
  }

  state.currentStudentId = student.studentId;
  localStorage.setItem(STORAGE_KEYS.CURRENT_STUDENT, student.studentId);
  localStorage.setItem(STORAGE_KEYS.LAST_TYPED_NAME, student.studentName);

  refreshAllViews(true);
  showToast(`🤖 ${student.studentName} 연구원님, 환영합니다! 작성 내용은 자동으로 이어서 저장됩니다.`, 'success');
}

function logoutStudent() {
  goHomeToLogin();
}

function renderStudioWorkspace(populateInputs = false) {
  const loginPanel = document.getElementById('student-login-panel');
  const workspacePanel = document.getElementById('student-workspace-panel');
  if (!loginPanel || !workspacePanel) return;

  // 현재 로그인한 학생 ID가 없다면 로그인 화면 표시
  if (!state.currentStudentId) {
    loginPanel.classList.remove('hidden');
    workspacePanel.classList.add('hidden');
    return;
  }

  // 현재 로그인한 학생이 배열에서 일시적으로 누락되었더라도 절대 로그인 화면으로 튕기지 않고 현재 입력창 상태로 즉시 복원!
  let student = findStudentById(state.currentStudentId);
  if (!student) {
    student = createEmptyStudentObject(state.currentStudentId);
    student.inputs = getStudioFormInputs();
    state.students.push(student);
    saveStudentsToLocalStorage(false);
  }

  loginPanel.classList.add('hidden');
  workspacePanel.classList.remove('hidden');

  const labelEl = document.getElementById('workspace-student-label');
  const statusBadgeEl = document.getElementById('workspace-status-badge');
  const versionBadgeEl = document.getElementById('workspace-version-badge');
  const historyCountEl = document.getElementById('student-history-count');

  const meta = STATUS_META[student.status] || STATUS_META.drafting;
  if (labelEl) labelEl.textContent = student.studentName;
  if (statusBadgeEl) {
    statusBadgeEl.className = `inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-extrabold ${meta.badgeClass}`;
    statusBadgeEl.textContent = meta.studentBadge;
  }
  if (versionBadgeEl) {
    versionBadgeEl.textContent = student.currentVersion > 0
      ? `현재 버전: v${student.currentVersion} (${(student.history || []).length}회 제출)`
      : '미제출 (작성중)';
  }
  if (historyCountEl) {
    historyCountEl.textContent = String((student.history || []).length);
  }

  renderStudentFeedbackBanner(student);

  if (populateInputs) {
    const inp = student.inputs || {};
    setInputValue('input-robot-name', inp.robotName || '');
    setInputValue('input-appearance', inp.appearance || '');
    setInputValue('input-purpose', inp.purpose || '');
    setInputValue('input-main-function', inp.mainFunction || '');
    setInputValue('input-sensor-name', inp.sensorName || '');
    setInputValue('input-sensor-target', inp.sensorTarget || '');
    setInputValue('input-sensor-action', inp.sensorAction || '');
    setInputValue('input-science-tech', inp.scienceTech || '');
    setInputValue('input-core-values', inp.coreValues || '');
    setInputValue('input-video-style', inp.videoStyle || '');

    if (student.videoPrompt && student.specSheet) {
      renderGeneratedOutputs(student.videoPrompt, student.specSheet);
    } else {
      const resultsSection = document.getElementById('generated-results-section');
      if (resultsSection) resultsSection.classList.add('hidden');
    }
  }

  highlightSelectedVideoStyleCard();
  evaluateCoachingAndProgress();
}

function renderStudentFeedbackBanner(student) {
  const banner = document.getElementById('student-feedback-banner');
  if (!banner) return;

  if (student.status === 'revision') {
    banner.className = 'rounded-2xl p-5 border-2 border-orange-400 bg-gradient-to-r from-orange-50 via-amber-50 to-orange-50 text-orange-950 revision-banner-pulse block';
    const timeLabel = student.feedbackAt ? formatDateTime(student.feedbackAt) : '방금 전';
    banner.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div class="flex items-start gap-3">
          <div class="w-11 h-11 rounded-2xl bg-orange-500 text-white flex items-center justify-center text-2xl shrink-0 shadow-md">
            🚨
          </div>
          <div class="space-y-1.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-orange-600 text-white">수정요청 도착!</span>
              <span class="text-xs font-bold text-orange-700">선생님의 코칭 피드백을 확인하고 내용을 보완해 다시 제출해 보세요!</span>
              <span class="text-[11px] text-orange-600/80">(${escapeHtml(timeLabel)})</span>
            </div>
            <div class="bg-white/90 border border-orange-200 rounded-xl p-3.5 text-sm font-semibold text-slate-800 leading-relaxed shadow-sm">
              “${escapeHtml(student.teacherFeedback || '입력 항목을 조금 더 구체적으로 보완해 다시 제출해 주세요!')}”
            </div>
          </div>
        </div>
      </div>
    `;
    return;
  }

  if (student.status === 'approved') {
    banner.className = 'rounded-2xl p-5 border-2 border-emerald-400 bg-gradient-to-r from-emerald-50 to-teal-50 text-emerald-950 block';
    banner.innerHTML = `
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div class="flex items-start gap-3">
          <div class="w-11 h-11 rounded-2xl bg-emerald-600 text-white flex items-center justify-center text-2xl shrink-0 shadow-md">
            🎉
          </div>
          <div class="space-y-1">
            <div class="flex items-center gap-2">
              <span class="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-emerald-600 text-white">전시승인 완료</span>
              <span class="text-sm font-extrabold text-emerald-900">선생님께서 로봇 기획서를 최종 전시 승인하셨어요!</span>
            </div>
            ${student.teacherFeedback ? `<p class="text-xs sm:text-sm text-emerald-800 font-medium mt-1">💬 선생님 피드백: “${escapeHtml(student.teacherFeedback)}”</p>` : ''}
          </div>
        </div>
        <button
          type="button"
          onclick="switchMainTab('expo'); openBoothDetailModal('${escapeHtml(student.studentId)}')"
          class="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold whitespace-nowrap shadow-sm transition self-start sm:self-center"
        >
          🏛️ 내 박람회 전시 부스 보러가기 →
        </button>
      </div>
    `;
    return;
  }

  if (student.teacherFeedback) {
    banner.className = 'rounded-2xl p-4 border border-blue-200 bg-blue-50/80 text-blue-950 block';
    banner.innerHTML = `
      <div class="flex items-start gap-3">
        <span class="text-xl">💬</span>
        <div class="text-xs sm:text-sm">
          <strong class="font-extrabold text-blue-900">선생님의 이전 피드백 메모:</strong>
          <p class="text-slate-700 mt-1">“${escapeHtml(student.teacherFeedback)}”</p>
        </div>
      </div>
    `;
    return;
  }

  banner.className = 'hidden';
  banner.innerHTML = '';
}

function setInputValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function getStudioFormInputs() {
  return {
    robotName: (document.getElementById('input-robot-name')?.value || '').trim(),
    appearance: (document.getElementById('input-appearance')?.value || '').trim(),
    purpose: (document.getElementById('input-purpose')?.value || '').trim(),
    mainFunction: (document.getElementById('input-main-function')?.value || '').trim(),
    sensorName: (document.getElementById('input-sensor-name')?.value || '').trim(),
    sensorTarget: (document.getElementById('input-sensor-target')?.value || '').trim(),
    sensorAction: (document.getElementById('input-sensor-action')?.value || '').trim(),
    scienceTech: (document.getElementById('input-science-tech')?.value || '').trim(),
    coreValues: (document.getElementById('input-core-values')?.value || '').trim(),
    videoStyle: (document.getElementById('input-video-style')?.value || '').trim(),
  };
}

// 1~5단계 예시 태그 버튼 클릭 시 입력창에 텍스트 추가
function appendTagToInput(inputId, rawTag) {
  const el = document.getElementById(inputId);
  if (!el) return;

  const cleanPhrase = rawTag.replace(/^#/, '').replace(/_/g, ' ').trim();
  const currentVal = el.value.trim();

  if (!currentVal) {
    el.value = cleanPhrase;
  } else if (!currentVal.includes(cleanPhrase)) {
    const sep = currentVal.endsWith(',') || currentVal.endsWith('.') ? ' ' : ', ';
    el.value = `${currentVal}${sep}${cleanPhrase}`;
  } else {
    showToast(`이미 '${cleanPhrase}' 내용이 포함되어 있어요!`, 'info');
  }

  el.focus();
  handleStudioInputChange();
  handleStudioStepMove();
}

// 6단계: 추구하는 가치 해시태그 추가 함수
function appendHashtagValue(tagStr) {
  const el = document.getElementById('input-core-values');
  if (!el) return;

  const normalizedTag = tagStr.startsWith('#') ? tagStr : `#${tagStr}`;
  const existing = parseCoreValuesHashtags(el.value);

  if (existing.includes(normalizedTag)) {
    showToast(`이미 ${normalizedTag} 해시태그가 추가되어 있어요!`, 'info');
  } else {
    existing.push(normalizedTag);
    el.value = existing.join(' ');
  }

  el.focus();
  handleStudioInputChange();
  handleStudioStepMove();
}

// 6단계 입력창 포커스 해제 시 자동으로 단어 앞에 # 붙이기
function normalizeCoreValuesHashtags() {
  const el = document.getElementById('input-core-values');
  if (!el || !el.value.trim()) return;
  el.value = formatCoreValuesString(el.value);
  handleStudioInputChange();
}

// 7단계: 영상 스타일 보기 선택 함수
function selectVideoStyleOption(styleValue) {
  const el = document.getElementById('input-video-style');
  if (!el) return;
  el.value = styleValue;
  highlightSelectedVideoStyleCard();
  handleStudioInputChange();
  handleStudioStepMove();
}

function highlightSelectedVideoStyleCard() {
  const currentStyle = (document.getElementById('input-video-style')?.value || '').trim();
  document.querySelectorAll('.video-style-card').forEach((card) => {
    const cardVal = (card.getAttribute('data-style-val') || '').trim();
    if (currentStyle && cardVal === currentStyle) {
      card.className = 'video-style-card text-left p-3.5 rounded-2xl border-2 border-blue-600 bg-blue-50/90 shadow-sm transition flex flex-col justify-between gap-1';
    } else {
      card.className = 'video-style-card text-left p-3.5 rounded-2xl border-2 border-slate-200 hover:border-blue-400 bg-slate-50/70 transition flex flex-col justify-between gap-1';
    }
  });
}

let autoSaveTimer = null;

// 글자 입력 시: 브라우저에는 0.1초 이내 즉시 저장 + 클라우드(Supabase/시트)로는 4초 간격 자동 전송
function handleStudioInputChange() {
  state.lastLocalStudentTypingAt = Date.now();
  highlightSelectedVideoStyleCard();
  evaluateCoachingAndProgress();

  const student = findStudentById(state.currentStudentId);
  if (!student) return;

  student.inputs = getStudioFormInputs();
  student.updatedAt = new Date().toISOString();
  saveStudentsToLocalStorage();

  const indicator = document.getElementById('workspace-autosave-indicator');
  if (indicator) {
    indicator.textContent = '💾 기기에 즉시 저장됨 (' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ')';
  }

  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    syncStudentToCloud(student);
  }, AUTO_SYNC_DEBOUNCE_MS);
}

// 다음 단계 입력칸으로 이동하거나(onchange) 태그/스타일 선택 시 즉시 클라우드로 전송
function handleStudioStepMove() {
  const student = findStudentById(state.currentStudentId);
  if (!student) return;

  student.inputs = getStudioFormInputs();
  student.updatedAt = new Date().toISOString();
  saveStudentsToLocalStorage();

  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  syncStudentToCloud(student);
}

/**
 * 7단계 실시간 코칭 질문 조건 검사 및 주황색 코칭 박스 제어
 * - 1단계: 외형 특징 15자 미만 시 코칭 표시
 * - 2단계: 제작 목적 15자 미만 시 코칭 표시
 * - 3단계: 주요 기능 20자 미만 시 코칭 표시
 * - 4단계: 4-2 또는 4-3이 10자 미만 시 코칭 표시
 * - 5단계: 과학 기술 15자 미만 시 코칭 표시
 * - 6단계: 추구하는 가치 해시태그 단어가 2개 미만 시 코칭 표시
 * - 7단계: 영상 스타일이 비어있을 시 코칭 표시
 */
function evaluateCoachingAndProgress() {
  const inputs = getStudioFormInputs();
  const valueHashtags = parseCoreValuesHashtags(inputs.coreValues);

  // 글자수 / 단어수 카운터 업데이트
  updateCharCounter('char-count-appearance', inputs.appearance.length, 15);
  updateCharCounter('char-count-purpose', inputs.purpose.length, 15);
  updateCharCounter('char-count-main-function', inputs.mainFunction.length, 20);
  updateCharCounter('char-count-sensor-target', inputs.sensorTarget.length, 10);
  updateCharCounter('char-count-sensor-action', inputs.sensorAction.length, 10);
  updateCharCounter('char-count-science-tech', inputs.scienceTech.length, 15);

  const countValEl = document.getElementById('count-core-values');
  if (countValEl) {
    if (valueHashtags.length >= 2) {
      countValEl.textContent = `✅ ${valueHashtags.length}개 해시태그 완료!`;
      countValEl.className = 'text-[11px] font-bold text-emerald-600';
    } else {
      countValEl.textContent = `${valueHashtags.length}개 / 최소 2개 이상 단어 필요`;
      countValEl.className = 'text-[11px] font-bold text-orange-600';
    }
  }

  // 각 단계 통과 조건
  const step1Pass = inputs.robotName.length >= 1 && inputs.appearance.length >= 15;
  const step2Pass = inputs.purpose.length >= 15;
  const step3Pass = inputs.mainFunction.length >= 20;
  const step4Pass = inputs.sensorName.length >= 2 && inputs.sensorTarget.length >= 10 && inputs.sensorAction.length >= 10;
  const step5Pass = inputs.scienceTech.length >= 15;
  const step6Pass = valueHashtags.length >= 2;
  const step7Pass = inputs.videoStyle.length >= 2;

  toggleCoachingBox('coaching-step-1', 'step1-status-pill', inputs.appearance.length < 15, step1Pass);
  toggleCoachingBox('coaching-step-2', 'step2-status-pill', inputs.purpose.length < 15, step2Pass);
  toggleCoachingBox('coaching-step-3', 'step3-status-pill', inputs.mainFunction.length < 20, step3Pass);
  toggleCoachingBox(
    'coaching-step-4',
    'step4-status-pill',
    inputs.sensorTarget.length < 10 || inputs.sensorAction.length < 10,
    step4Pass
  );
  toggleCoachingBox('coaching-step-5', 'step5-status-pill', inputs.scienceTech.length < 15, step5Pass);
  toggleCoachingBox('coaching-step-6', 'step6-status-pill', valueHashtags.length < 2, step6Pass);
  toggleCoachingBox('coaching-step-7', 'step7-status-pill', !step7Pass, step7Pass);

  // 전체 7단계 달성도 바 업데이트
  const allSteps = [step1Pass, step2Pass, step3Pass, step4Pass, step5Pass, step6Pass, step7Pass];
  const passedCount = allSteps.filter(Boolean).length;
  const percent = Math.round((passedCount / 7) * 100);

  const progressText = document.getElementById('coaching-progress-text');
  const progressBar = document.getElementById('coaching-progress-bar');

  if (progressText) {
    progressText.textContent = `7단계 중 ${passedCount}단계 구체화 완료 (${percent}%)`;
    progressText.className = passedCount === 7
      ? 'text-xs font-extrabold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full'
      : 'text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full';
  }
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
}

function updateCharCounter(elId, len, minLen) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (len >= minLen) {
    el.textContent = `✅ ${len}자 (구체화 완료!)`;
    el.className = 'text-[11px] font-bold text-emerald-600';
  } else {
    el.textContent = `${len}자 / 권장 ${minLen}자 이상 (${minLen - len}자 더 적어보세요)`;
    el.className = 'text-[11px] font-bold text-orange-600';
  }
}

function toggleCoachingBox(boxId, pillId, showOrangeCoaching, isStepComplete) {
  const box = document.getElementById(boxId);
  const pill = document.getElementById(pillId);

  if (box) {
    box.classList.toggle('hidden', !showOrangeCoaching);
  }
  if (pill) {
    if (isStepComplete) {
      pill.textContent = '✅ 구체화 완료';
      pill.className = 'px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-100 text-emerald-800 whitespace-nowrap';
    } else {
      pill.textContent = '💡 구체화 코칭 중';
      pill.className = 'px-2.5 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800 whitespace-nowrap';
    }
  }
}

// B. [✨ 프롬프트 자동 변환하기]
function generatePrompts() {
  const student = findStudentById(state.currentStudentId);
  if (!student) return;

  normalizeCoreValuesHashtags();
  const inputs = getStudioFormInputs();
  if (!inputs.robotName) {
    showToast('1-1. 로봇 이름을 먼저 입력해 주세요!', 'warning');
    document.getElementById('input-robot-name')?.focus();
    return;
  }

  const videoPrompt = buildPromptFromInputs(inputs);
  const specSheet = buildSpecSheetFromInputs(inputs);

  student.inputs = inputs;
  student.videoPrompt = videoPrompt;
  student.specSheet = specSheet;
  student.updatedAt = new Date().toISOString();

  saveStudentsToLocalStorage();
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
  syncStudentToCloud(student);

  renderGeneratedOutputs(videoPrompt, specSheet);

  const section = document.getElementById('generated-results-section');
  if (section) {
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  showToast('✨ AI 영상 프롬프트와 박람회 개조식 기획서가 생성되었습니다!', 'success');
}

function renderGeneratedOutputs(videoPrompt, specSheet) {
  const section = document.getElementById('generated-results-section');
  const promptEl = document.getElementById('output-video-prompt');
  const specContainer = document.getElementById('output-spec-sheet-container');

  if (!section || !promptEl || !specContainer) return;
  section.classList.remove('hidden');

  promptEl.textContent = videoPrompt;
  specContainer.innerHTML = renderSpecSheetHtml(specSheet);
}

function renderSpecSheetHtml(spec) {
  if (!spec) return '<p class="text-xs text-slate-400">아직 생성된 개조식 기획서가 없습니다.</p>';

  const valueTags = parseCoreValuesHashtags(spec.coreValues?.content || '');
  const valueBadgesHtml = valueTags.length > 0
    ? valueTags.map((tag) => `<span class="px-2.5 py-0.5 rounded-full bg-indigo-100 text-indigo-800 font-extrabold text-xs">${escapeHtml(tag)}</span>`).join(' ')
    : `<span class="text-slate-500">${escapeHtml(spec.coreValues?.content || '-')}</span>`;

  return `
    <div class="space-y-2.5 text-xs sm:text-sm">
      <!-- 1. 출품 로봇명 & 외형 -->
      <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
        <div class="font-extrabold text-blue-900 mb-1.5 flex items-center justify-between">
          <span>${escapeHtml(spec.robotAndAppearance?.title || '🤖 출품 로봇명 & 외형')}</span>
          <span class="px-2 py-0.5 rounded bg-blue-600 text-white text-xs font-extrabold">${escapeHtml(spec.robotAndAppearance?.robotName || '-')}</span>
        </div>
        <ul class="list-disc list-inside text-slate-700 space-y-1 leading-relaxed">
          <li><strong>로봇명:</strong> ${escapeHtml(spec.robotAndAppearance?.robotName || '-')}</li>
          <li><strong>외형 및 기계 구조:</strong> ${escapeHtml(spec.robotAndAppearance?.appearance || '-')}</li>
        </ul>
      </div>

      <!-- 2. 개발 배경 및 목적 -->
      <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
        <div class="font-extrabold text-blue-900 mb-1">${escapeHtml(spec.purpose?.title || '🎯 개발 배경 및 목적')}</div>
        <ul class="list-disc list-inside text-slate-700 leading-relaxed">
          <li>${escapeHtml(spec.purpose?.content || '-')}</li>
        </ul>
      </div>

      <!-- 3. 핵심 작동 기능 및 구조 -->
      <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
        <div class="font-extrabold text-blue-900 mb-1">${escapeHtml(spec.mainFunction?.title || '⚙️ 핵심 작동 기능 및 구조')}</div>
        <ul class="list-disc list-inside text-slate-700 leading-relaxed">
          <li>${escapeHtml(spec.mainFunction?.content || '-')}</li>
        </ul>
      </div>

      <!-- 4. 스마트 감지 메커니즘 -->
      <div class="bg-indigo-50/70 rounded-2xl p-3.5 border border-indigo-200">
        <div class="font-extrabold text-indigo-950 mb-1.5">${escapeHtml(spec.sensorMechanism?.title || '📡 스마트 감지 메커니즘 (센서명 / 감지 대상 / 작동 연동)')}</div>
        <ul class="space-y-1 text-slate-700 leading-relaxed">
          <li>• <strong>탑재 센서명:</strong> <span class="font-semibold text-indigo-700">${escapeHtml(spec.sensorMechanism?.sensorName || '-')}</span></li>
          <li>• <strong>세부 감지 대상:</strong> ${escapeHtml(spec.sensorMechanism?.sensorTarget || '-')}</li>
          <li>• <strong>감지 후 작동 연동:</strong> ${escapeHtml(spec.sensorMechanism?.sensorAction || '-')}</li>
        </ul>
      </div>

      <!-- 5. 적용 융합 과학기술 -->
      <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
        <div class="font-extrabold text-blue-900 mb-1">${escapeHtml(spec.scienceTech?.title || '🔬 적용 융합 과학기술')}</div>
        <ul class="list-disc list-inside text-slate-700 leading-relaxed">
          <li>${escapeHtml(spec.scienceTech?.content || '-')}</li>
        </ul>
      </div>

      <!-- 6. 추구하는 핵심 가치 & 7. 영상 연출 스타일 -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
          <div class="font-extrabold text-blue-900 mb-1.5">${escapeHtml(spec.coreValues?.title || '💎 추구하는 핵심 가치')}</div>
          <div class="flex flex-wrap gap-1.5">${valueBadgesHtml}</div>
        </div>
        <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200">
          <div class="font-extrabold text-blue-900 mb-1">${escapeHtml(spec.videoStyle?.title || '🎨 영상 연출 스타일')}</div>
          <div class="text-slate-700 font-medium leading-snug">${escapeHtml(spec.videoStyle?.content || '-')}</div>
        </div>
      </div>
    </div>
  `;
}

// [📋 영상 프롬프트 복사하기]
async function copyVideoPrompt(customPromptText) {
  const textToCopy = customPromptText || document.getElementById('output-video-prompt')?.textContent || '';
  if (!textToCopy.trim()) {
    showToast('복사할 프롬프트가 없습니다. 먼저 프롬프트를 변환해 주세요!', 'warning');
    return;
  }

  try {
    await navigator.clipboard.writeText(textToCopy);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = textToCopy;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }

  const btn = document.getElementById('btn-copy-video-prompt');
  if (btn && !customPromptText) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<span>✅</span><span>클립보드에 복사 완료!</span>';
    setTimeout(() => {
      btn.innerHTML = orig;
    }, 2200);
  }
  showToast('📋 AI 영상 프롬프트가 클립보드에 복사되었습니다!', 'success');
}

// [🏛️ 로봇 박람회 전시관으로 설명 전달 및 교사 제출]
function submitToExpoAndTeacher() {
  const student = findStudentById(state.currentStudentId);
  if (!student) return;

  normalizeCoreValuesHashtags();
  const inputs = getStudioFormInputs();
  if (!inputs.robotName) {
    showToast('1-1. 로봇 이름을 입력해야 제출할 수 있어요!', 'warning');
    document.getElementById('input-robot-name')?.focus();
    return;
  }

  const valueTags = parseCoreValuesHashtags(inputs.coreValues);
  if (valueTags.length < 2) {
    showToast('6. 추구하는 가치를 해시태그(#) 단어 2가지 이상 입력해 주세요!', 'warning');
    document.getElementById('input-core-values')?.focus();
    return;
  }

  if (!inputs.videoStyle) {
    showToast('7. 영상 스타일을 선택해 주세요!', 'warning');
    document.getElementById('input-video-style')?.focus();
    return;
  }

  const videoPrompt = buildPromptFromInputs(inputs);
  const specSheet = buildSpecSheetFromInputs(inputs);

  const nextVersionNum = (Number(student.currentVersion) || 0) + 1;
  const versionLabel = nextVersionNum === 1
    ? '버전 1 (최초 제출)'
    : `버전 ${nextVersionNum} (${nextVersionNum - 1}차 수정)`;

  const nowIso = new Date().toISOString();
  const newVersionEntry = {
    version: nextVersionNum,
    label: versionLabel,
    submittedAt: nowIso,
    inputs: JSON.parse(JSON.stringify(inputs)),
    videoPrompt,
    specSheet: JSON.parse(JSON.stringify(specSheet)),
    teacherFeedbackBefore: student.teacherFeedback || '',
  };

  if (!Array.isArray(student.history)) {
    student.history = [];
  }
  student.history.push(newVersionEntry);
  student.currentVersion = nextVersionNum;
  student.inputs = inputs;
  student.videoPrompt = videoPrompt;
  student.specSheet = specSheet;
  student.status = 'submitted';
  student.updatedAt = nowIso;

  saveStudentsToLocalStorage();
  syncStudentToGas(student, newVersionEntry);
  refreshAllViews(false);

  showToast(`🎉 [${versionLabel}] 제출 완료! 선생님께서 [전시 승인]하시면 박람회 전시관에 부스가 공개됩니다.`, 'success');
}

function openCurrentStudentHistoryModal() {
  if (!state.currentStudentId) return;
  openHistoryCompareModal(state.currentStudentId);
}

// ============================================================================
// 8. [탭 2] 🏛️ 미래 로봇 박람회 전시관 (전시 승인된 부스만 표시, 영상 첨부, 상세 모달)
// ============================================================================
function getExpoEligibleStudents() {
  return state.students.filter((s) => s.status === 'approved');
}

function renderExpoBooths() {
  const grid = document.getElementById('expo-booth-grid');
  if (!grid) return;

  const allBooths = getExpoEligibleStudents();
  const hasVideoCount = allBooths.filter((s) => s.video && s.video.type && s.video.type !== 'none').length;

  const statTotal = document.getElementById('expo-stat-total');
  const statVideo = document.getElementById('expo-stat-video');
  if (statTotal) statTotal.textContent = String(allBooths.length);
  if (statVideo) statVideo.textContent = String(hasVideoCount);

  const query = (document.getElementById('expo-search-input')?.value || '').trim().toLowerCase();

  const filtered = allBooths.filter((s) => {
    if (query) {
      const hay = `${s.studentName} ${s.inputs?.robotName || ''} ${s.inputs?.purpose || ''} ${s.inputs?.coreValues || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full bg-white rounded-3xl p-12 text-center border border-slate-200">
        <div class="text-4xl mb-3">🏛️</div>
        <h3 class="text-base font-extrabold text-slate-800">현재 전시 승인된 로봇 박람회 부스가 없습니다</h3>
        <p class="text-xs text-slate-500 mt-1">[탭 1: 로봇 설계실]에서 제출한 뒤 선생님의 [전시 승인]을 받으면 이곳에 부스가 전시됩니다.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map((student, idx) => {
    const boothNum = String(idx + 1).padStart(2, '0');
    const meta = STATUS_META[student.status] || STATUS_META.submitted;
    const hasVideo = student.video && student.video.type && student.video.type !== 'none';
    const robotName = student.inputs?.robotName || '출품 로봇';
    const spec = student.specSheet || buildSpecSheetFromInputs(student.inputs || {});
    const valueTags = parseCoreValuesHashtags(student.inputs?.coreValues || spec.coreValues?.content || '');

    return `
      <article class="booth-card bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden flex flex-col justify-between">
        <div>
          <!-- 부스 상단 영상/홀로그램 썸네일 영역 -->
          <div
            onclick="openBoothDetailModal('${escapeHtml(student.studentId)}')"
            class="relative aspect-video bg-slate-950 cursor-pointer overflow-hidden group"
          >
            ${renderBoothCardThumbnail(student)}

            <div class="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <span class="px-2.5 py-1 rounded-xl bg-slate-900/80 backdrop-blur-md text-white font-extrabold text-[11px] border border-white/15">
                BOOTH #${boothNum} · v${student.currentVersion || 1}
              </span>
              <span class="px-2.5 py-1 rounded-full text-[11px] font-extrabold ${meta.badgeClass} shadow-sm">
                ${meta.label}
              </span>
            </div>

            <div class="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              ${hasVideo
                ? `<span class="px-2.5 py-1 rounded-lg bg-cyan-500/90 text-slate-950 font-extrabold text-[11px] flex items-center gap-1 shadow">
                     <span>▶️</span><span>로봇 소개 영상 상영중</span>
                   </span>`
                : `<span class="px-2.5 py-1 rounded-lg bg-slate-800/85 text-slate-300 font-bold text-[11px] border border-white/10">
                     🎥 영상 미첨부 (클릭하여 보기)
                   </span>`
              }
              <span class="px-2.5 py-1 rounded-lg bg-white/90 text-slate-900 font-extrabold text-[11px] group-hover:bg-blue-600 group-hover:text-white transition">
                상세 관람 →
              </span>
            </div>
          </div>

          <!-- 부스 본문: 개조식 로봇 기획서 핵심 요약 -->
          <div class="p-5 space-y-3" onclick="openBoothDetailModal('${escapeHtml(student.studentId)}')" role="button">
            <div>
              <span class="text-xs font-bold text-blue-600">🧑‍🔬 ${escapeHtml(student.studentName)} 연구원</span>
              <h3 class="text-lg font-extrabold text-slate-900 leading-snug mt-0.5">${escapeHtml(robotName)}</h3>
            </div>

            ${valueTags.length > 0 ? `
              <div class="flex flex-wrap gap-1">
                ${valueTags.map((t) => `<span class="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-bold text-[11px]">${escapeHtml(t)}</span>`).join('')}
              </div>
            ` : ''}

            <div class="bg-slate-50 rounded-2xl p-3.5 border border-slate-200/80 space-y-2 text-xs">
              <div class="flex items-start gap-2">
                <span class="shrink-0">🎯</span>
                <p class="text-slate-700 line-clamp-2"><strong class="text-slate-900">목적:</strong> ${escapeHtml(spec.purpose?.content || '-')}</p>
              </div>
              <div class="flex items-start gap-2">
                <span class="shrink-0">⚙️</span>
                <p class="text-slate-700 line-clamp-2"><strong class="text-slate-900">핵심기능:</strong> ${escapeHtml(spec.mainFunction?.content || '-')}</p>
              </div>
              <div class="flex items-start gap-2">
                <span class="shrink-0">📡</span>
                <p class="text-slate-700 line-clamp-1"><strong class="text-slate-900">감지센서:</strong> ${escapeHtml(spec.sensorMechanism?.sensorName || '-')}</p>
              </div>
              <div class="flex items-start gap-2">
                <span class="shrink-0">🔬</span>
                <p class="text-slate-700 line-clamp-1"><strong class="text-slate-900">융합기술:</strong> ${escapeHtml(spec.scienceTech?.content || '-')}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 부스 하단 버튼 영역: 영상 첨부하기 & 응원하기 (+ 관리자 잠금 해제 시 수정/삭제 버튼 표시) -->
        <div class="px-5 pb-5 pt-1 space-y-2">
          <div class="flex items-center gap-2">
            <button
              type="button"
              onclick="openVideoAttachModal('${escapeHtml(student.studentId)}')"
              class="flex-1 py-2.5 px-3 rounded-xl text-xs font-extrabold ${hasVideo ? 'bg-slate-100 hover:bg-slate-200 text-slate-700' : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'} transition flex items-center justify-center gap-1.5"
            >
              <span>🎥</span>
              <span>${hasVideo ? '로봇 소개 영상 변경하기' : '로봇 소개 영상 첨부하기'}</span>
            </button>

            <button
              type="button"
              onclick="likeBooth('${escapeHtml(student.studentId)}')"
              class="py-2.5 px-3.5 rounded-xl text-xs font-extrabold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition flex items-center gap-1"
              title="멋진 로봇 부스 응원하기"
            >
              <span>❤️</span>
              <span>${Number(student.likes) || 0}</span>
            </button>
          </div>

          ${state.teacherUnlocked ? `
            <div class="flex items-center gap-2 pt-1.5 border-t border-slate-100">
              <button
                type="button"
                onclick="openAdminEditStudentModal('${escapeHtml(student.studentId)}')"
                class="flex-1 py-2 px-3 rounded-xl text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 transition flex items-center justify-center gap-1"
              >
                <span>✏️</span>
                <span>관리자 수정</span>
              </button>
              <button
                type="button"
                onclick="deleteStudentByAdmin('${escapeHtml(student.studentId)}')"
                class="py-2 px-3 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition flex items-center justify-center gap-1"
              >
                <span>🗑️</span>
                <span>부스 삭제</span>
              </button>
            </div>
          ` : ''}
        </div>
      </article>
    `;
  }).join('');
}

function renderBoothCardThumbnail(student) {
  const hasVideo = student.video && student.video.type && student.video.type !== 'none';
  const robotEmoji = pickRobotEmoji(student.inputs);

  if (hasVideo && student.video.type === 'local' && localVideoObjectUrls[student.studentId]) {
    return `
      <video
        src="${localVideoObjectUrls[student.studentId]}"
        muted
        loop
        playsinline
        onmouseover="this.play()"
        onmouseout="this.pause()"
        class="w-full h-full object-cover opacity-90 group-hover:scale-105 transition duration-500"
      ></video>
    `;
  }

  if (
    hasVideo &&
    student.video.type === 'url' &&
    student.video.url &&
    (/\.(mp4|webm|mov)(\?|$)/i.test(student.video.url) || student.video.url.includes('/storage/v1/object/public/'))
  ) {
    const safeUrl = extractSafeHttpsUrl(student.video.url);
    if (safeUrl) {
      return `
        <video
          src="${escapeHtml(safeUrl)}"
          muted
          loop
          playsinline
          preload="metadata"
          onmouseover="this.play()"
          onmouseout="this.pause()"
          class="w-full h-full object-cover opacity-90 group-hover:scale-105 transition duration-500"
        ></video>
      `;
    }
  }

  return `
    <div class="w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950 to-blue-950 holo-scanline flex flex-col items-center justify-center p-4 text-center relative">
      <div class="w-16 h-16 rounded-full bg-cyan-400/15 border border-cyan-400/40 flex items-center justify-center text-4xl animate-float-robot shadow-lg shadow-cyan-500/20">
        ${robotEmoji}
      </div>
      <div class="text-xs font-extrabold text-cyan-300 mt-2 tracking-wide truncate max-w-[85%]">
        ${escapeHtml(student.inputs?.robotName || 'FUTURE ROBOT')}
      </div>
      <div class="text-[10px] text-slate-400 mt-0.5 truncate max-w-[80%]">
        📡 ${escapeHtml(student.inputs?.sensorName || 'AI Sensor System')}
      </div>
    </div>
  `;
}

function pickRobotEmoji(inputs = {}) {
  const text = `${inputs.robotName || ''} ${inputs.purpose || ''} ${inputs.appearance || ''}`;
  if (text.includes('바다') || text.includes('해양') || text.includes('수중') || text.includes('아쿠아')) return '🐬';
  if (text.includes('산불') || text.includes('소방') || text.includes('화재') || text.includes('파이어')) return '🚒';
  if (text.includes('노인') || text.includes('응급') || text.includes('돌봄') || text.includes('의료')) return '🩺';
  if (text.includes('우주') || text.includes('위성')) return '🛰️';
  if (text.includes('대기') || text.includes('공기') || text.includes('드론')) return '🛸';
  return '🤖';
}

function likeBooth(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;
  student.likes = (Number(student.likes) || 0) + 1;
  student.updatedAt = new Date().toISOString();
  saveStudentsToLocalStorage();
  syncStudentToGas(student);
  renderExpoBooths();
}

// 부스 상세 모달 열기
function openBoothDetailModal(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;
  state.activeBoothStudentId = student.studentId;

  const modal = document.getElementById('booth-detail-modal');
  if (!modal) return;

  const allBooths = getExpoEligibleStudents();
  const idx = allBooths.findIndex((s) => s.studentId === student.studentId);
  const boothNum = idx >= 0 ? String(idx + 1).padStart(2, '0') : '01';
  const meta = STATUS_META[student.status] || STATUS_META.submitted;

  document.getElementById('modal-booth-number').textContent = `BOOTH #${boothNum}`;
  document.getElementById('modal-booth-title').textContent = student.inputs?.robotName || '출품 로봇';
  document.getElementById('modal-booth-creator').textContent = `기획 연구원: ${student.studentName}`;
  document.getElementById('modal-booth-status').textContent = meta.label;
  document.getElementById('modal-booth-version').textContent = `Version ${student.currentVersion || 1}`;

  const promptText = student.videoPrompt || buildPromptFromInputs(student.inputs || {});
  document.getElementById('modal-booth-video-prompt').textContent = promptText;

  const copyBtn = document.getElementById('modal-btn-copy-prompt');
  if (copyBtn) {
    copyBtn.onclick = () => copyVideoPrompt(promptText);
  }

  const attachBtn = document.getElementById('modal-btn-attach-video');
  if (attachBtn) {
    attachBtn.onclick = () => openVideoAttachModal(student.studentId);
  }

  const playerBox = document.getElementById('modal-video-player-box');
  if (playerBox) {
    playerBox.innerHTML = renderBoothVideoPlayerHtml(student);
  }

  const specBox = document.getElementById('modal-booth-spec-sheet');
  if (specBox) {
    const spec = student.specSheet || buildSpecSheetFromInputs(student.inputs || {});
    specBox.innerHTML = renderSpecSheetHtml(spec);
  }

  modal.classList.remove('hidden');
}

function closeBoothDetailModal() {
  const modal = document.getElementById('booth-detail-modal');
  if (!modal) return;
  const playerBox = document.getElementById('modal-video-player-box');
  if (playerBox) playerBox.innerHTML = '';
  modal.classList.add('hidden');
  state.activeBoothStudentId = null;
}

function renderBoothVideoPlayerHtml(student) {
  const video = student.video || { type: 'none', url: '', title: '' };

  if (video.type === 'local') {
    const blobUrl = localVideoObjectUrls[student.studentId] || (video.url && video.url.startsWith('data:video') ? video.url : '');
    if (blobUrl) {
      return `
        <video
          src="${blobUrl}"
          controls
          autoplay
          loop
          playsinline
          class="w-full h-full object-contain bg-black"
        ></video>
      `;
    }
  }

  if (video.type === 'url' && video.url) {
    const rawUrl = extractSafeHttpsUrl(video.url);
    if (rawUrl) {
      const ytEmbed = toYouTubeEmbedUrl(rawUrl);
      if (ytEmbed) {
        return `
          <iframe
            src="${escapeHtml(ytEmbed)}"
            allowfullscreen
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            class="w-full h-full border-0"
          ></iframe>
        `;
      }

      const webEmbedUrl = toWebEmbedUrl(rawUrl);
      if (webEmbedUrl) {
        return `
          <iframe
            src="${escapeHtml(webEmbedUrl)}"
            allowfullscreen="allowfullscreen"
            allow="fullscreen; autoplay"
            class="w-full h-full border-0"
          ></iframe>
        `;
      }

      return `
        <video
          src="${escapeHtml(rawUrl)}"
          controls
          autoplay
          loop
          playsinline
          class="w-full h-full object-contain bg-black"
        ></video>
      `;
    }
  }

  return `
    <div class="text-center p-6 space-y-3">
      <div class="w-16 h-16 rounded-2xl bg-white/10 text-white flex items-center justify-center text-3xl mx-auto">
        🎥
      </div>
      <div class="text-white font-extrabold text-sm sm:text-base">
        아직 로봇 소개 영상이 첨부되지 않았어요
      </div>
      <p class="text-xs text-slate-400 max-w-sm mx-auto">
        제작한 MP4 로봇 소개 영상을 업로드하거나, 영상 공유 링크를 등록해 부스 스크린을 켜보세요!
      </p>
      <button
        type="button"
        onclick="openVideoAttachModal('${escapeHtml(student.studentId)}')"
        class="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-extrabold shadow-lg transition inline-flex items-center gap-1.5"
      >
        <span>🎥</span>
        <span>로봇 소개 영상 첨부하기</span>
      </button>
    </div>
  `;
}

function extractSafeHttpsUrl(inputStr) {
  if (!inputStr) return null;
  const trimmed = String(inputStr).trim();
  const srcMatch = trimmed.match(/src=["']([^"']+)["']/i);
  const candidate = (srcMatch ? srcMatch[1] : trimmed).trim();
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:') return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function toWebEmbedUrl(inputStr) {
  const safeUrl = extractSafeHttpsUrl(inputStr);
  if (!safeUrl || !safeUrl.includes('/design/')) return null;

  const base = safeUrl.split('?')[0].replace(/\/(edit|watch)$/, '/view');
  const viewUrl = base.endsWith('/view') ? base : `${base.replace(/\/$/, '')}/view`;
  return `${viewUrl}?embed`;
}

function toYouTubeEmbedUrl(url) {
  if (!url) return null;
  const regExp = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const match = url.match(regExp);
  return match ? `https://www.youtube.com/embed/${match[1]}` : null;
}

function openVideoAttachModal(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  state.videoAttachTargetId = student.studentId;
  state.pendingVideoFileData = null;

  const labelEl = document.getElementById('video-modal-student-label');
  if (labelEl) {
    labelEl.textContent = `${student.studentName} · ${student.inputs?.robotName || '로봇 부스'}`;
  }

  const fileInput = document.getElementById('video-file-input');
  if (fileInput) fileInput.value = '';
  document.getElementById('selected-video-file-info')?.classList.add('hidden');

  const urlInput = document.getElementById('video-url-input');
  if (urlInput) {
    urlInput.value = student.video?.type === 'url' ? student.video.url : '';
  }

  switchVideoModalTab('file');
  document.getElementById('video-attach-modal')?.classList.remove('hidden');
}

function closeVideoAttachModal() {
  document.getElementById('video-attach-modal')?.classList.add('hidden');
  state.videoAttachTargetId = null;
  state.pendingVideoFileData = null;
}

function switchVideoModalTab(tabKey) {
  state.videoModalTab = tabKey;
  ['file', 'url'].forEach((k) => {
    const btn = document.getElementById(`vtab-btn-${k}`);
    const panel = document.getElementById(`vtab-panel-${k}`);
    if (panel) panel.classList.toggle('hidden', k !== tabKey);
    if (btn) {
      btn.className = k === tabKey
        ? 'py-2.5 px-3 rounded-lg text-xs font-bold bg-white text-blue-600 shadow-sm transition'
        : 'py-2.5 px-3 rounded-lg text-xs font-bold text-slate-600 hover:text-slate-900 transition';
    }
  });
}

function handleVideoFileSelected(event) {
  const file = event.target?.files?.[0];
  if (!file) return;

  state.pendingVideoFileData = file;
  const infoBox = document.getElementById('selected-video-file-info');
  const nameEl = document.getElementById('selected-video-filename');
  if (infoBox && nameEl) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    nameEl.textContent = `🎬 ${file.name} (${sizeMb} MB)`;
    infoBox.classList.remove('hidden');
  }
}

async function uploadVideoToSupabaseStorage(studentId, file) {
  if (!isSupabaseConfigured()) return null;
  if (!supabaseClient) initSupabaseClient();
  if (!supabaseClient) return null;

  try {
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
    const safeKey = encodeURIComponent(String(studentId || 'student').trim()).replace(/%/g, '');
    const filePath = `booths/booth_${safeKey}_${Date.now()}.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
      .from(SUPABASE_VIDEO_BUCKET)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || 'video/mp4',
      });

    if (uploadError) {
      console.warn('Supabase Storage 영상 업로드 실패:', uploadError.message);
      return null;
    }

    const { data } = supabaseClient.storage
      .from(SUPABASE_VIDEO_BUCKET)
      .getPublicUrl(filePath);

    return data?.publicUrl || null;
  } catch (err) {
    console.warn('Supabase Storage 업로드 예외:', err);
    return null;
  }
}

async function saveAttachedVideo() {
  const student = findStudentById(state.videoAttachTargetId);
  if (!student) return;

  const saveBtn = document.getElementById('btn-save-attached-video');
  const origBtnHtml = saveBtn ? saveBtn.innerHTML : '';

  try {
    if (state.videoModalTab === 'file') {
      if (!state.pendingVideoFileData) {
        showToast('업로드할 MP4 영상 파일을 먼저 선택해 주세요!', 'warning');
        return;
      }
      const file = state.pendingVideoFileData;
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '⏳ 영상 업로드 중...';
      }

      // 1) 로컬 IndexedDB에도 캐시 저장
      await saveVideoBlobToIndexedDB(student.studentId, file, file.name);

      // 2) Supabase Storage가 연동되어 있으면 클라우드 버킷(robot-videos)에 업로드하여 모든 기기에서 재생되는 공개 URL 획득!
      const cloudVideoUrl = await uploadVideoToSupabaseStorage(student.studentId, file);
      if (cloudVideoUrl) {
        student.video = {
          type: 'url',
          url: cloudVideoUrl,
          title: file.name,
        };
      } else {
        student.video = {
          type: 'local',
          url: 'LOCAL_INDEXED_DB',
          title: file.name,
        };
      }
    } else if (state.videoModalTab === 'url') {
      const rawUrl = (document.getElementById('video-url-input')?.value || '').trim();
      if (!rawUrl) {
        showToast('영상 공유 링크 또는 동영상 URL을 입력해 주세요!', 'warning');
        return;
      }
      const safeUrl = extractSafeHttpsUrl(rawUrl);
      if (!safeUrl) {
        showToast('보안을 위해 https:// 로 시작하는 유효한 영상 링크 또는 동영상 URL만 등록할 수 있습니다.', 'warning');
        return;
      }
      student.video = {
        type: 'url',
        url: safeUrl,
        title: '로봇 소개 영상',
      };
    }

    student.updatedAt = new Date().toISOString();
    saveStudentsToLocalStorage();
    await syncStudentToCloud(student);

    const targetId = student.studentId;
    closeVideoAttachModal();
    refreshAllViews(false);

    if (state.activeBoothStudentId === targetId) {
      openBoothDetailModal(targetId);
    }
    showToast('🎥 박람회 부스에 로봇 소개 영상이 성공적으로 등록되었습니다!', 'success');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origBtnHtml || '✅ 부스에 영상 등록하기';
    }
  }
}

// ============================================================================
// 9. [탭 3] 🔒 교사 관리자 화면 (실시간 현황/필터, 상세 확인, 수정 요청, 전시 승인, 이력 비교)
// ============================================================================
function renderTeacherSection() {
  const authPanel = document.getElementById('teacher-auth-panel');
  const dashPanel = document.getElementById('teacher-dashboard-panel');
  if (!authPanel || !dashPanel) return;

  if (!state.teacherUnlocked) {
    authPanel.classList.remove('hidden');
    dashPanel.classList.add('hidden');
    return;
  }

  authPanel.classList.add('hidden');
  dashPanel.classList.remove('hidden');
  renderTeacherDashboard();
}

function lockTeacherDashboard() {
  state.teacherUnlocked = false;
  sessionStorage.removeItem(STORAGE_KEYS.TEACHER_UNLOCKED);
  renderTeacherSection();
  showToast('🔒 교사 관리자 화면이 잠겼습니다.', 'info');
}

function setTeacherFilter(filterKey) {
  state.teacherFilter = filterKey;
  document.querySelectorAll('.teacher-stat-card').forEach((card) => {
    const key = card.getAttribute('data-teacher-filter');
    if (key === filterKey) {
      card.classList.add('border-blue-600');
      card.classList.remove('border-slate-200');
    } else {
      card.classList.remove('border-blue-600');
      card.classList.add('border-slate-200');
    }
  });
  renderTeacherDashboard();
}

function renderTeacherDashboard() {
  const totalCount = state.students.length;
  const draftingCount = state.students.filter((s) => s.status === 'drafting').length;
  const submittedCount = state.students.filter((s) => s.status === 'submitted').length;
  const revisionCount = state.students.filter((s) => s.status === 'revision').length;
  const approvedCount = state.students.filter((s) => s.status === 'approved').length;

  setText('t-stat-all', `${totalCount}명`);
  setText('t-stat-drafting', `${draftingCount}명`);
  setText('t-stat-submitted', `${submittedCount}명`);
  setText('t-stat-revision', `${revisionCount}명`);
  setText('t-stat-approved', `${approvedCount}명`);

  const searchQuery = (document.getElementById('teacher-search-input')?.value || '').trim().toLowerCase();
  const filtered = state.students.filter((s) => {
    if (state.teacherFilter !== 'all' && s.status !== state.teacherFilter) return false;
    if (searchQuery) {
      const hay = `${s.studentName} ${s.inputs?.robotName || ''}`.toLowerCase();
      if (!hay.includes(searchQuery)) return false;
    }
    return true;
  });

  setText('teacher-table-count', `${filtered.length}명`);

  const tbody = document.getElementById('teacher-student-tbody');
  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="py-10 text-center text-slate-400 text-xs">
          해당 조건의 학생 데이터가 없습니다.
        </td>
      </tr>
    `;
  } else {
    tbody.innerHTML = filtered.map((st) => {
      const meta = STATUS_META[st.status] || STATUS_META.drafting;
      const isSelected = st.studentId === state.selectedTeacherStudentId;
      const hasVideo = st.video && st.video.type && st.video.type !== 'none';
      const historyCount = (st.history || []).length;

      return `
        <tr
          onclick="selectTeacherStudent('${escapeHtml(st.studentId)}')"
          class="cursor-pointer transition ${isSelected ? 'bg-blue-50/90 font-semibold' : 'hover:bg-slate-50'}"
        >
          <td class="py-3.5 px-4">
            <div class="font-extrabold text-slate-900">${escapeHtml(st.studentName)}</div>
            <div class="text-[11px] text-slate-400">${formatDateTime(st.updatedAt)}</div>
          </td>
          <td class="py-3.5 px-3">
            <div class="font-bold text-slate-800 truncate max-w-[140px]">
              ${escapeHtml(st.inputs?.robotName || '(미입력)')}
            </div>
          </td>
          <td class="py-3.5 px-3">
            <span class="inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${meta.badgeClass}">
              ${meta.label}
            </span>
          </td>
          <td class="py-3.5 px-3 text-center">
            <button
              type="button"
              onclick="event.stopPropagation(); openHistoryCompareModal('${escapeHtml(st.studentId)}')"
              class="px-2.5 py-1 rounded-lg text-xs font-extrabold ${historyCount > 1 ? 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'} transition inline-flex items-center gap-1"
              title="버전별 제출 이력 비교하기"
            >
              <span>🕒</span>
              <span>${st.currentVersion > 0 ? `v${st.currentVersion} (${historyCount}회)` : '미제출'}</span>
            </button>
          </td>
          <td class="py-3.5 px-3 text-center">
            ${hasVideo
              ? '<span class="text-xs font-bold text-emerald-600">🎥 첨부됨</span>'
              : '<span class="text-xs text-slate-400">미첨부</span>'}
          </td>
          <td class="py-3.5 px-4 text-right">
            <div class="inline-flex items-center justify-end gap-1">
              <button
                type="button"
                onclick="event.stopPropagation(); selectTeacherStudent('${escapeHtml(st.studentId)}')"
                class="px-2.5 py-1.5 rounded-xl text-xs font-bold ${isSelected ? 'bg-blue-600 text-white' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'} transition"
                title="학생 로봇 기획서 상세 확인 및 수정"
              >
                ✏️ 상세/수정
              </button>
              <button
                type="button"
                onclick="event.stopPropagation(); deleteStudentByAdmin('${escapeHtml(st.studentId)}')"
                class="px-2.5 py-1.5 rounded-xl text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 transition"
                title="학생 및 로봇 데이터 삭제"
              >
                🗑️ 삭제
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  if (!findStudentById(state.selectedTeacherStudentId) && state.students.length > 0) {
    state.selectedTeacherStudentId = state.students[0].studentId;
  }
  renderTeacherDetailPanel(false);
}

function selectTeacherStudent(studentId) {
  state.selectedTeacherStudentId = studentId;
  state.teacherDetailDirty = false;
  state.teacherDetailRenderedStudentId = null;
  renderTeacherDashboard();
  renderTeacherDetailPanel(true);
}

function markTeacherDetailDirty(studentId) {
  state.teacherDetailDirty = true;
  if (studentId) {
    state.teacherDetailRenderedStudentId = studentId;
  }
  const badge = document.getElementById('td-editing-lock-badge');
  if (badge) {
    badge.classList.remove('hidden');
  }
}

function isTeacherEditingDetailPanel(studentId) {
  const panel = document.getElementById('teacher-detail-panel');
  if (!panel) return false;
  if (state.teacherDetailRenderedStudentId !== studentId) return false;
  if (state.teacherDetailDirty) return true;
  const activeEl = document.activeElement;
  if (activeEl && panel.contains(activeEl) && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.tagName === 'SELECT')) {
    return true;
  }
  return false;
}

function renderTeacherDetailPanel(forceRender = false) {
  const panel = document.getElementById('teacher-detail-panel');
  if (!panel) return;

  const student = findStudentById(state.selectedTeacherStudentId);
  if (!student) {
    state.teacherDetailRenderedStudentId = null;
    state.teacherDetailDirty = false;
    panel.innerHTML = `<div class="p-8 text-center text-slate-400 text-sm">좌측 목록에서 학생을 선택하세요.</div>`;
    return;
  }

  // ★ 핵심 보호: 선생님이 우측 상세 패널에서 학생 글을 고치고 계실 때는 자동 새로고침이 입력칸을 덮어쓰지 않도록 보호 ★
  if (!forceRender && isTeacherEditingDetailPanel(student.studentId)) {
    return;
  }

  state.teacherDetailRenderedStudentId = student.studentId;
  if (forceRender) {
    state.teacherDetailDirty = false;
  }

  const meta = STATUS_META[student.status] || STATUS_META.drafting;
  const inp = student.inputs || {};
  const promptText = student.videoPrompt || buildPromptFromInputs(inp);
  const historyCount = (student.history || []).length;
  const valueTags = parseCoreValuesHashtags(inp.coreValues);
  const safeStudentId = escapeHtml(student.studentId);

  panel.innerHTML = `
    <div class="bg-slate-900 text-white px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <div class="flex items-center gap-2 flex-wrap">
          <span class="text-base font-extrabold">${escapeHtml(student.studentName)} 학생</span>
          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${meta.badgeClass}">${meta.label}</span>
          <span id="td-editing-lock-badge" class="${state.teacherDetailDirty ? '' : 'hidden'} px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-400 text-slate-950">
            🔒 선생님 수정 중 (자동 새로고침 잠금)
          </span>
        </div>
        <p class="text-xs text-slate-300 mt-0.5">
          출품 로봇: <strong>${escapeHtml(inp.robotName || '미입력')}</strong> · 현재 버전: v${student.currentVersion || 0}
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onclick="deleteStudentByAdmin('${safeStudentId}')"
          class="px-2.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold transition flex items-center gap-1 shadow"
        >
          <span>🗑️</span>
          <span>삭제</span>
        </button>
        <button
          type="button"
          onclick="openHistoryCompareModal('${safeStudentId}')"
          class="px-2.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-extrabold transition flex items-center gap-1 shadow"
        >
          <span>🕒</span>
          <span>이력 (${historyCount})</span>
        </button>
      </div>
    </div>

    <div class="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
      
      <!-- 교사 피드백 및 상태 변경 액션 박스 -->
      <div class="bg-orange-50/70 border-2 border-orange-200 rounded-2xl p-4 space-y-3">
        <div class="flex items-center justify-between">
          <label for="teacher-feedback-input" class="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
            <span>💬</span>
            <span>교사 피드백 코멘트 &amp; 수정 요청 / 전시 승인</span>
          </label>
        </div>

        <div class="flex flex-wrap gap-1">
          <button type="button" onclick="insertTeacherFeedbackChip('외형 특징에 바퀴/다리 구조와 재질을 조금 더 구체적으로 적어볼까요?')" class="px-2 py-1 rounded-lg bg-white hover:bg-orange-100 text-orange-800 border border-orange-200 text-[11px] font-bold transition">+ 외형 구체화 요청</button>
          <button type="button" onclick="insertTeacherFeedbackChip('4-2 감지 대상과 4-3 감지 후 로봇의 어떤 장치가 어떻게 움직이는지 연결해 적어주세요!')" class="px-2 py-1 rounded-lg bg-white hover:bg-orange-100 text-orange-800 border border-orange-200 text-[11px] font-bold transition">+ 센서 연동 보완</button>
          <button type="button" onclick="insertTeacherFeedbackChip('7단계 항목이 모두 구체적으로 아주 잘 작성되었어요! 박람회 전시를 승인합니다. 👏')" class="px-2 py-1 rounded-lg bg-white hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-bold transition">+ 칭찬 및 승인 코멘트</button>
        </div>

        <textarea
          id="teacher-feedback-input"
          rows="3"
          oninput="markTeacherDetailDirty('${safeStudentId}')"
          placeholder="학생에게 전달할 구체적인 수정 요청 피드백이나 칭찬 코멘트를 입력하세요..."
          class="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 focus:border-orange-500 outline-none text-xs sm:text-sm bg-white"
        >${escapeHtml(student.teacherFeedback || '')}</textarea>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onclick="sendRevisionRequest('${safeStudentId}')"
            class="py-2.5 px-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-extrabold text-xs shadow-sm transition flex items-center justify-center gap-1.5"
          >
            <span>🔄</span>
            <span>수정 요청 보내기</span>
          </button>

          <button
            type="button"
            onclick="approveStudentExpo('${safeStudentId}')"
            class="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs shadow-sm transition flex items-center justify-center gap-1.5"
          >
            <span>✅</span>
            <span>전시 승인</span>
          </button>
        </div>
      </div>

      <!-- 학생이 입력한 7단계 항목 상세 확인 및 즉시 수정 -->
      <div class="space-y-3 bg-slate-50/70 p-4 rounded-2xl border border-slate-200">
        <div class="flex items-center justify-between gap-2">
          <h4 class="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <span>✏️</span>
            <span>학생 입력 7단계 상세 확인 및 수정</span>
          </h4>
          <button
            type="button"
            onclick="saveTeacherInlineEdits('${safeStudentId}', false)"
            class="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm transition flex items-center gap-1"
          >
            <span>💾</span>
            <span>수정 내용 저장</span>
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div class="bg-white p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
            <label class="block font-bold text-slate-700">학생 이름</label>
            <input
              id="td-edit-student-name"
              type="text"
              oninput="markTeacherDetailDirty('${safeStudentId}')"
              value="${escapeHtml(student.studentName || '')}"
              class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs font-bold text-slate-900"
            />
          </div>
          <div class="bg-white p-2.5 rounded-xl border border-slate-200 text-xs space-y-1">
            <label class="block font-bold text-slate-700">1-1. 출품 로봇 이름</label>
            <input
              id="td-edit-robot-name"
              type="text"
              oninput="markTeacherDetailDirty('${safeStudentId}')"
              value="${escapeHtml(inp.robotName || '')}"
              class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs font-bold text-blue-700"
            />
          </div>
        </div>

        <div class="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div class="flex justify-between font-bold text-slate-800">
            <label for="td-edit-appearance">1-2. 로봇 외형 특징</label>
            <span class="${(inp.appearance || '').length >= 15 ? 'text-emerald-600' : 'text-orange-600'}">${(inp.appearance || '').length}자</span>
          </div>
          <textarea
            id="td-edit-appearance"
            rows="2"
            oninput="markTeacherDetailDirty('${safeStudentId}')"
            class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs text-slate-700 leading-relaxed"
          >${escapeHtml(inp.appearance || '')}</textarea>
        </div>

        <div class="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div class="flex justify-between font-bold text-slate-800">
            <label for="td-edit-purpose">2. 제작 목적 (미래 사회 문제)</label>
            <span class="${(inp.purpose || '').length >= 15 ? 'text-emerald-600' : 'text-orange-600'}">${(inp.purpose || '').length}자</span>
          </div>
          <textarea
            id="td-edit-purpose"
            rows="2"
            oninput="markTeacherDetailDirty('${safeStudentId}')"
            class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs text-slate-700 leading-relaxed"
          >${escapeHtml(inp.purpose || '')}</textarea>
        </div>

        <div class="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div class="flex justify-between font-bold text-slate-800">
            <label for="td-edit-main-function">3. 주요 기능 (작동 모습과 구조)</label>
            <span class="${(inp.mainFunction || '').length >= 20 ? 'text-emerald-600' : 'text-orange-600'}">${(inp.mainFunction || '').length}자</span>
          </div>
          <textarea
            id="td-edit-main-function"
            rows="2"
            oninput="markTeacherDetailDirty('${safeStudentId}')"
            class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs text-slate-700 leading-relaxed"
          >${escapeHtml(inp.mainFunction || '')}</textarea>
        </div>

        <div class="bg-indigo-50/60 p-3 rounded-xl border border-indigo-200 text-xs space-y-2">
          <div class="font-bold text-indigo-950">4. 탑재 감지 장치 (센서 3단계)</div>
          <div>
            <label for="td-edit-sensor-name" class="block text-[11px] font-bold text-slate-700 mb-0.5">4-1. 센서명</label>
            <input
              id="td-edit-sensor-name"
              type="text"
              oninput="markTeacherDetailDirty('${safeStudentId}')"
              value="${escapeHtml(inp.sensorName || '')}"
              class="w-full px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white focus:border-indigo-500 outline-none text-xs text-slate-800"
            />
          </div>
          <div>
            <label for="td-edit-sensor-target" class="block text-[11px] font-bold text-slate-700 mb-0.5">4-2. 세부 감지 대상 (${(inp.sensorTarget || '').length}자)</label>
            <input
              id="td-edit-sensor-target"
              type="text"
              oninput="markTeacherDetailDirty('${safeStudentId}')"
              value="${escapeHtml(inp.sensorTarget || '')}"
              class="w-full px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white focus:border-indigo-500 outline-none text-xs text-slate-800"
            />
          </div>
          <div>
            <label for="td-edit-sensor-action" class="block text-[11px] font-bold text-slate-700 mb-0.5">4-3. 감지 후 로봇의 행동 (${(inp.sensorAction || '').length}자)</label>
            <input
              id="td-edit-sensor-action"
              type="text"
              oninput="markTeacherDetailDirty('${safeStudentId}')"
              value="${escapeHtml(inp.sensorAction || '')}"
              class="w-full px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-white focus:border-indigo-500 outline-none text-xs text-slate-800"
            />
          </div>
        </div>

        <div class="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div class="flex justify-between font-bold text-slate-800">
            <label for="td-edit-science-tech">5. 적용된 과학 기술 (융합 기술)</label>
            <span class="${(inp.scienceTech || '').length >= 15 ? 'text-emerald-600' : 'text-orange-600'}">${(inp.scienceTech || '').length}자</span>
          </div>
          <textarea
            id="td-edit-science-tech"
            rows="2"
            oninput="markTeacherDetailDirty('${safeStudentId}')"
            class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs text-slate-700 leading-relaxed"
          >${escapeHtml(inp.scienceTech || '')}</textarea>
        </div>

        <div class="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <div class="flex justify-between font-bold text-slate-800">
            <label for="td-edit-core-values">6. 추구하는 가치 (해시태그)</label>
            <span class="${valueTags.length >= 2 ? 'text-emerald-600' : 'text-orange-600'}">${valueTags.length}개 단어</span>
          </div>
          <input
            id="td-edit-core-values"
            type="text"
            oninput="markTeacherDetailDirty('${safeStudentId}')"
            value="${escapeHtml(formatCoreValuesString(inp.coreValues) || '')}"
            class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs font-bold text-indigo-700"
          />
        </div>

        <div class="bg-white p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
          <label for="td-edit-video-style" class="block font-bold text-slate-800">7. 선택한 영상 스타일</label>
          <input
            id="td-edit-video-style"
            type="text"
            oninput="markTeacherDetailDirty('${safeStudentId}')"
            value="${escapeHtml(inp.videoStyle || '')}"
            class="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 focus:border-blue-500 outline-none text-xs font-semibold text-blue-700"
          />
        </div>

        <button
          type="button"
          onclick="saveTeacherInlineEdits('${safeStudentId}', false)"
          class="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs shadow-sm transition flex items-center justify-center gap-1.5"
        >
          <span>💾</span>
          <span>수정한 내용 저장 및 프롬프트·기획서 자동 갱신</span>
        </button>
      </div>

      <!-- 변환된 AI 영상 프롬프트 확인 -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-extrabold text-slate-500 uppercase tracking-wider">🎬 변환된 AI 영상 프롬프트</h4>
          <button type="button" onclick="copyVideoPrompt('${escapeJsString(promptText)}')" class="text-xs font-bold text-indigo-600 hover:underline">📋 복사</button>
        </div>
        <div class="bg-slate-900 text-slate-100 p-3.5 rounded-xl text-xs leading-relaxed">
          ${escapeHtml(promptText)}
        </div>
      </div>

      <!-- 변환된 개조식 기획서 확인 -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <h4 class="text-xs font-extrabold text-slate-500 uppercase tracking-wider">📋 박람회 개조식 기획서</h4>
          <button
            type="button"
            onclick="openBoothDetailModal('${safeStudentId}')"
            class="text-xs font-bold text-blue-600 hover:underline"
          >
            🏛️ 부스 화면으로 열기 →
          </button>
        </div>
        ${renderSpecSheetHtml(student.specSheet || buildSpecSheetFromInputs(inp))}
      </div>

    </div>
  `;
}

function saveTeacherInlineEdits(studentId, silent = false) {
  const student = findStudentById(studentId);
  if (!student) return false;

  const nameEl = document.getElementById('td-edit-student-name');
  if (!nameEl) return false;

  const newStudentName = (nameEl.value || '').trim();
  if (!newStudentName) {
    if (!silent) showToast('학생 이름을 입력해 주세요.', 'warning');
    return false;
  }

  const updatedInputs = {
    robotName: (document.getElementById('td-edit-robot-name')?.value || '').trim(),
    appearance: (document.getElementById('td-edit-appearance')?.value || '').trim(),
    purpose: (document.getElementById('td-edit-purpose')?.value || '').trim(),
    mainFunction: (document.getElementById('td-edit-main-function')?.value || '').trim(),
    sensorName: (document.getElementById('td-edit-sensor-name')?.value || '').trim(),
    sensorTarget: (document.getElementById('td-edit-sensor-target')?.value || '').trim(),
    sensorAction: (document.getElementById('td-edit-sensor-action')?.value || '').trim(),
    scienceTech: (document.getElementById('td-edit-science-tech')?.value || '').trim(),
    coreValues: formatCoreValuesString((document.getElementById('td-edit-core-values')?.value || '').trim()),
    videoStyle: (document.getElementById('td-edit-video-style')?.value || '').trim()
  };

  student.studentName = newStudentName;
  student.inputs = updatedInputs;
  student.videoPrompt = buildPromptFromInputs(updatedInputs);
  student.specSheet = buildSpecSheetFromInputs(updatedInputs);
  student.updatedAt = new Date().toISOString();

  if (Array.isArray(student.history) && student.history.length > 0) {
    const latest = student.history[student.history.length - 1];
    latest.inputs = JSON.parse(JSON.stringify(updatedInputs));
    latest.videoPrompt = student.videoPrompt;
    latest.specSheet = JSON.parse(JSON.stringify(student.specSheet));
  }

  state.teacherDetailDirty = false;

  if (!silent) {
    saveStudentsToLocalStorage();
    syncStudentToCloud(student);
    refreshAllViews(state.currentStudentId === student.studentId);
    renderTeacherDetailPanel(true);
    showToast(`✏️ ${student.studentName} 학생의 로봇 기획서 수정 사항이 저장되었습니다.`, 'success');
  }
  return true;
}

function insertTeacherFeedbackChip(text) {
  const el = document.getElementById('teacher-feedback-input');
  if (!el) return;
  el.value = el.value.trim() ? `${el.value.trim()} ${text}` : text;
  if (state.selectedTeacherStudentId) {
    markTeacherDetailDirty(state.selectedTeacherStudentId);
  }
  el.focus();
}

function sendRevisionRequest(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  const feedbackInput = document.getElementById('teacher-feedback-input');
  const comment = (feedbackInput?.value || '').trim();
  if (!comment) {
    showToast('학생에게 전달할 수정 요청 피드백 코멘트를 입력해 주세요!', 'warning');
    feedbackInput?.focus();
    return;
  }

  try {
    saveTeacherInlineEdits(studentId, true);
  } catch (err) {
    console.warn('인라인 수정 저장 생략:', err);
  }

  student.status = 'revision';
  student.teacherFeedback = comment;
  student.feedbackAt = new Date().toISOString();
  student.updatedAt = new Date().toISOString();

  if (Array.isArray(student.history) && student.history.length > 0) {
    student.history[student.history.length - 1].teacherFeedbackAfter = comment;
  }

  state.teacherDetailDirty = false;
  saveStudentsToLocalStorage();
  syncStudentToCloud(student);
  refreshAllViews(state.currentStudentId === student.studentId);
  renderTeacherDetailPanel(true);

  showToast(`🔄 ${student.studentName} 학생에게 수정 요청 피드백을 발송했습니다!`, 'success');
}

function approveStudentExpo(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  const feedbackInput = document.getElementById('teacher-feedback-input');
  const comment = (feedbackInput?.value || '').trim();

  try {
    saveTeacherInlineEdits(studentId, true);
  } catch (err) {
    console.warn('인라인 수정 저장 생략:', err);
  }

  student.status = 'approved';
  if (comment) {
    student.teacherFeedback = comment;
    student.feedbackAt = new Date().toISOString();
  }
  student.videoPrompt = buildPromptFromInputs(student.inputs || {});
  student.specSheet = buildSpecSheetFromInputs(student.inputs || {});
  if (!student.currentVersion || student.currentVersion < 1) {
    student.currentVersion = 1;
  }
  student.updatedAt = new Date().toISOString();

  state.teacherDetailDirty = false;
  saveStudentsToLocalStorage();
  syncStudentToCloud(student);
  refreshAllViews(state.currentStudentId === student.studentId);
  renderTeacherDetailPanel(true);

  showToast(`✅ ${student.studentName} 학생의 로봇 기획서를 [전시승인] 처리했습니다!`, 'success');
}

// ============================================================================
// 9-2. 교사 관리자: 학생 로봇 데이터 직접 수정 및 삭제 기능
// ============================================================================
function openAdminEditStudentModal(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  const inp = student.inputs || {};
  setInputValue('admin-edit-target-id', student.studentId);
  setInputValue('admin-edit-student-name', student.studentName || '');
  setInputValue('admin-edit-robot-name', inp.robotName || '');
  setInputValue('admin-edit-status', student.status || 'submitted');
  setInputValue('admin-edit-appearance', inp.appearance || '');
  setInputValue('admin-edit-purpose', inp.purpose || '');
  setInputValue('admin-edit-main-function', inp.mainFunction || '');
  setInputValue('admin-edit-sensor-name', inp.sensorName || '');
  setInputValue('admin-edit-sensor-target', inp.sensorTarget || '');
  setInputValue('admin-edit-sensor-action', inp.sensorAction || '');
  setInputValue('admin-edit-science-tech', inp.scienceTech || '');
  setInputValue('admin-edit-core-values', inp.coreValues || '');
  setInputValue('admin-edit-video-style', inp.videoStyle || '');

  document.getElementById('admin-edit-student-modal')?.classList.remove('hidden');
}

function closeAdminEditStudentModal() {
  document.getElementById('admin-edit-student-modal')?.classList.add('hidden');
}

function saveAdminEditedStudent(event) {
  if (event) event.preventDefault();

  const targetId = (document.getElementById('admin-edit-target-id')?.value || '').trim();
  const student = findStudentById(targetId);
  if (!student) return;

  const newName = (document.getElementById('admin-edit-student-name')?.value || '').trim();
  const newStatus = (document.getElementById('admin-edit-status')?.value || 'submitted').trim();

  const updatedInputs = {
    robotName: (document.getElementById('admin-edit-robot-name')?.value || '').trim(),
    appearance: (document.getElementById('admin-edit-appearance')?.value || '').trim(),
    purpose: (document.getElementById('admin-edit-purpose')?.value || '').trim(),
    mainFunction: (document.getElementById('admin-edit-main-function')?.value || '').trim(),
    sensorName: (document.getElementById('admin-edit-sensor-name')?.value || '').trim(),
    sensorTarget: (document.getElementById('admin-edit-sensor-target')?.value || '').trim(),
    sensorAction: (document.getElementById('admin-edit-sensor-action')?.value || '').trim(),
    scienceTech: (document.getElementById('admin-edit-science-tech')?.value || '').trim(),
    coreValues: formatCoreValuesString(document.getElementById('admin-edit-core-values')?.value || ''),
    videoStyle: (document.getElementById('admin-edit-video-style')?.value || '').trim(),
  };

  if (!newName || !updatedInputs.robotName) {
    showToast('학생 이름과 로봇 이름은 비워둘 수 없습니다.', 'warning');
    return;
  }

  student.studentName = newName;
  student.status = newStatus;
  student.inputs = updatedInputs;
  student.videoPrompt = buildPromptFromInputs(updatedInputs);
  student.specSheet = buildSpecSheetFromInputs(updatedInputs);
  student.updatedAt = new Date().toISOString();

  // 최신 제출 버전 이력도 함께 동기화
  if (Array.isArray(student.history) && student.history.length > 0) {
    const lastVer = student.history[student.history.length - 1];
    lastVer.inputs = JSON.parse(JSON.stringify(updatedInputs));
    lastVer.videoPrompt = student.videoPrompt;
    lastVer.specSheet = JSON.parse(JSON.stringify(student.specSheet));
  }

  state.teacherDetailDirty = false;
  saveStudentsToLocalStorage();
  syncStudentToCloud(student);
  closeAdminEditStudentModal();

  // 현재 로그인한 학생이 수정 대상이면 입력창도 즉시 갱신
  refreshAllViews(state.currentStudentId === student.studentId);
  renderTeacherDetailPanel(true);

  if (state.activeBoothStudentId === student.studentId) {
    openBoothDetailModal(student.studentId);
  }

  showToast(`✏️ ${student.studentName} 학생의 로봇 기획서가 수정되었습니다!`, 'success');
}

function deleteStudentFromEditModal() {
  const targetId = (document.getElementById('admin-edit-target-id')?.value || '').trim();
  if (!targetId) return;
  closeAdminEditStudentModal();
  deleteStudentByAdmin(targetId);
}

async function deleteStudentByAdmin(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  const robotLabel = student.inputs?.robotName || '미입력 로봇';
  const confirmed = confirm(
    `정말로 '${student.studentName}' 학생이 제출한 '${robotLabel}' 로봇 데이터를 삭제하시겠습니까?\n\n삭제하면 학생 목록과 박람회 전시관 부스에서 모두 삭제됩니다.`
  );
  if (!confirmed) return;

  const deletedId = String(student.studentId || '').trim();
  const deletedName = String(student.studentName || '').trim();

  // 삭제 기록(Tombstone) 저장: 동기화 폴링 시 시트/DB에서 다시 복구되는 현상 방지
  const tombstoneTime = Date.now() + 86400000;
  if (!state.deletedMap) state.deletedMap = {};
  if (deletedId) state.deletedMap[deletedId] = tombstoneTime;
  if (deletedName) state.deletedMap[deletedName] = tombstoneTime;
  saveDeletedMapToStorage();

  state.students = state.students.filter((s) => {
    const sId = String(s.studentId || '').trim();
    const sName = String(s.studentName || '').trim();
    return sId !== deletedId && sId !== deletedName && sName !== deletedId && sName !== deletedName;
  });

  if (state.currentStudentId === deletedId || state.currentStudentId === deletedName) {
    state.currentStudentId = null;
    localStorage.removeItem(STORAGE_KEYS.CURRENT_STUDENT);
  }

  if (state.selectedTeacherStudentId === deletedId || state.selectedTeacherStudentId === deletedName) {
    state.selectedTeacherStudentId = state.students[0]?.studentId || null;
    state.teacherDetailDirty = false;
  }

  if (state.activeBoothStudentId === deletedId || state.activeBoothStudentId === deletedName) {
    closeBoothDetailModal();
  }

  saveStudentsToLocalStorage();
  refreshAllViews(true);
  renderTeacherDetailPanel(true);
  showToast(`🗑️ '${deletedName}' 학생의 로봇 데이터가 삭제되었습니다.`, 'info');

  await deleteStudentFromCloud(deletedId, deletedName);
}

async function deleteStudentFromCloud(studentId, studentName = '') {
  if (!studentId) return;
  state.isSyncing = true;
  try {
    updateSyncStatusHeader('개별 행 삭제 동기화 중...');

    // 1) Supabase 개별 행(Row) 삭제 (전체 테이블 삭제 절대 없음)
    if (isSupabaseConfigured() && supabaseClient) {
      try {
        await supabaseClient
          .from(SUPABASE_TABLE)
          .delete()
          .eq('student_id', studentId);
        if (studentName && studentName !== studentId) {
          await supabaseClient
            .from(SUPABASE_TABLE)
            .delete()
            .eq('student_name', studentName);
        }
      } catch (sbErr) {
        console.warn('Supabase 개별 학생 행 삭제 실패:', sbErr);
      }
    }

    // 2) GAS 개별 행(Row) 삭제 (sync_all 전체 덮어쓰기 완전 제거!)
    if (isGasConfigured()) {
      await fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'delete_student',
          studentId,
          studentName,
        }),
      });
    }

    state.lastSyncedAt = new Date().toISOString();
  } catch (err) {
    console.warn('클라우드 학생 삭제 통신 생략:', err);
  } finally {
    state.isSyncing = false;
    updateSyncStatusHeader();
  }
}

const deleteStudentFromGas = deleteStudentFromCloud;

// ============================================================================
// 10. [🕒 수정 이력 보기] (버전 1, 버전 2, 버전 3... 변화 과정 비교 모달)
// ============================================================================
function openHistoryCompareModal(studentId) {
  const student = findStudentById(studentId);
  if (!student) return;

  const modal = document.getElementById('history-compare-modal');
  const titleEl = document.getElementById('history-modal-title');
  const subEl = document.getElementById('history-modal-subtitle');
  const bodyEl = document.getElementById('history-modal-body');
  if (!modal || !bodyEl) return;

  const history = Array.isArray(student.history) ? student.history : [];
  if (titleEl) {
    titleEl.textContent = `🕒 ${student.studentName} 학생의 작성 내용 수정 이력 (총 ${history.length}개 버전)`;
  }
  if (subEl) {
    subEl.textContent = '학생이 수정해서 다시 제출할 때마다 기존 데이터가 덮어씌워지지 않고 버전별로 누적 저장됩니다.';
  }

  if (history.length === 0) {
    bodyEl.innerHTML = `
      <div class="bg-slate-50 rounded-2xl p-10 text-center border border-slate-200">
        <div class="text-3xl mb-2">📝</div>
        <div class="text-sm font-extrabold text-slate-800">아직 제출된 버전 이력이 없습니다 (현재 작성중)</div>
        <p class="text-xs text-slate-500 mt-1">[탭 1: 로봇 설계실]에서 제출 버튼을 누르면 버전 1(최초 제출)부터 누적 기록됩니다.</p>
      </div>
    `;
    modal.classList.remove('hidden');
    return;
  }

  const leftIdx = Math.max(0, history.length - 2);
  const rightIdx = history.length - 1;

  bodyEl.innerHTML = `
    ${history.length >= 2 ? `
      <div class="bg-indigo-50/70 border border-indigo-200 rounded-2xl p-4 space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div class="text-xs sm:text-sm font-extrabold text-indigo-950 flex items-center gap-2">
            <span>🔍</span>
            <span>버전 간 작성 내용 변화 비교 (Before ➔ After)</span>
          </div>
          <div class="flex items-center gap-2 text-xs">
            <select id="hist-select-left" onchange="updateHistoryComparisonView('${escapeHtml(student.studentId)}')" class="px-3 py-1.5 rounded-xl border border-indigo-300 bg-white font-bold text-slate-800">
              ${history.map((h, i) => `<option value="${i}" ${i === leftIdx ? 'selected' : ''}>${escapeHtml(h.label || `버전 ${h.version}`)}</option>`).join('')}
            </select>
            <span class="font-extrabold text-indigo-600">➔</span>
            <select id="hist-select-right" onchange="updateHistoryComparisonView('${escapeHtml(student.studentId)}')" class="px-3 py-1.5 rounded-xl border border-indigo-300 bg-white font-bold text-indigo-700">
              ${history.map((h, i) => `<option value="${i}" ${i === rightIdx ? 'selected' : ''}>${escapeHtml(h.label || `버전 ${h.version}`)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div id="history-diff-container">
          ${renderTwoVersionDiffHtml(history[leftIdx], history[rightIdx])}
        </div>
      </div>
    ` : ''}

    <div class="space-y-4">
      <h4 class="text-sm font-extrabold text-slate-900 flex items-center gap-2">
        <span>📚</span>
        <span>전체 누적 제출 버전 타임라인 (${history.length}회)</span>
      </h4>

      <div class="grid grid-cols-1 md:grid-cols-${Math.min(history.length, 3)} gap-4">
        ${history.map((ver) => renderSingleVersionCardHtml(ver)).join('')}
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
}

function updateHistoryComparisonView(studentId) {
  const student = findStudentById(studentId);
  if (!student || !Array.isArray(student.history)) return;

  const leftIdx = Number(document.getElementById('hist-select-left')?.value || 0);
  const rightIdx = Number(document.getElementById('hist-select-right')?.value || 0);
  const container = document.getElementById('history-diff-container');
  if (container && student.history[leftIdx] && student.history[rightIdx]) {
    container.innerHTML = renderTwoVersionDiffHtml(student.history[leftIdx], student.history[rightIdx]);
  }
}

function renderTwoVersionDiffHtml(oldVer, newVer) {
  const fields = [
    { key: 'robotName', label: '1-1. 로봇 이름' },
    { key: 'appearance', label: '1-2. 외형 특징' },
    { key: 'purpose', label: '2. 제작 목적' },
    { key: 'mainFunction', label: '3. 주요 기능' },
    { key: 'sensorName', label: '4-1. 탑재 센서' },
    { key: 'sensorTarget', label: '4-2. 세부 감지 대상' },
    { key: 'sensorAction', label: '4-3. 감지 정보 활용' },
    { key: 'scienceTech', label: '5. 적용 과학 기술' },
    { key: 'coreValues', label: '6. 추구하는 가치' },
    { key: 'videoStyle', label: '7. 영상 스타일' },
  ];

  const rowsHtml = fields.map((f) => {
    const valOld = (oldVer.inputs?.[f.key] || '').trim();
    const valNew = (newVer.inputs?.[f.key] || '').trim();
    const isChanged = valOld !== valNew;
    const charDiff = valNew.length - valOld.length;
    const diffBadge = isChanged
      ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold ${charDiff >= 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
           ✨ 수정됨 (${charDiff >= 0 ? `+${charDiff}자 구체화` : `${charDiff}자`})
         </span>`
      : `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">동일</span>`;

    return `
      <div class="bg-white rounded-xl p-3.5 border ${isChanged ? 'border-indigo-300 shadow-sm' : 'border-slate-200'} space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-extrabold text-slate-800">${f.label}</span>
          ${diffBadge}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <div class="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-600">
            <div class="text-[10px] font-bold text-slate-400 mb-1">${escapeHtml(oldVer.label)} (${valOld.length}자)</div>
            <div>${escapeHtml(valOld || '-')}</div>
          </div>
          <div class="p-2.5 rounded-lg ${isChanged ? 'bg-emerald-50/70 border border-emerald-300 text-slate-900 font-medium' : 'bg-slate-50 border border-slate-200 text-slate-600'}">
            <div class="text-[10px] font-bold ${isChanged ? 'text-emerald-700' : 'text-slate-400'} mb-1">${escapeHtml(newVer.label)} (${valNew.length}자)</div>
            <div>${escapeHtml(valNew || '-')}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  return `<div class="space-y-2.5">${rowsHtml}</div>`;
}

function renderSingleVersionCardHtml(ver) {
  const inp = ver.inputs || {};
  return `
    <div class="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3 flex flex-col justify-between">
      <div class="space-y-2.5">
        <div class="flex items-center justify-between border-b border-slate-200 pb-2.5">
          <span class="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-extrabold">
            ${escapeHtml(ver.label || `버전 ${ver.version}`)}
          </span>
          <span class="text-[11px] text-slate-500 font-medium">
            🕒 ${formatDateTime(ver.submittedAt)}
          </span>
        </div>

        ${ver.teacherFeedbackBefore ? `
          <div class="bg-orange-50 border border-orange-200 rounded-xl p-2.5 text-[11px] text-orange-900">
            <strong>💡 반영한 교사 수정 요청:</strong> “${escapeHtml(ver.teacherFeedbackBefore)}”
          </div>
        ` : ''}

        <div class="space-y-1.5 text-xs text-slate-700">
          <div><strong class="text-slate-900">🤖 로봇명:</strong> ${escapeHtml(inp.robotName || '-')}</div>
          <div><strong class="text-slate-900">🎨 외형:</strong> ${escapeHtml(inp.appearance || '-')}</div>
          <div><strong class="text-slate-900">🎯 목적:</strong> ${escapeHtml(inp.purpose || '-')}</div>
          <div><strong class="text-slate-900">⚙️ 기능:</strong> ${escapeHtml(inp.mainFunction || '-')}</div>
          <div><strong class="text-slate-900">📡 센서:</strong> ${escapeHtml(inp.sensorName || '-')} ➔ ${escapeHtml(inp.sensorTarget || '-')} ➔ ${escapeHtml(inp.sensorAction || '-')}</div>
          <div><strong class="text-slate-900">🔬 과학기술:</strong> ${escapeHtml(inp.scienceTech || '-')}</div>
          <div><strong class="text-slate-900">💎 추구가치:</strong> ${escapeHtml(inp.coreValues || '-')}</div>
          <div><strong class="text-slate-900">🎬 영상스타일:</strong> ${escapeHtml(inp.videoStyle || '-')}</div>
        </div>
      </div>

      <div class="pt-2 border-t border-slate-200">
        <div class="text-[11px] font-bold text-slate-500 mb-1">🎬 당시 생성된 AI 영상 프롬프트:</div>
        <div class="bg-white p-2.5 rounded-xl border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
          ${escapeHtml(ver.videoPrompt || '-')}
        </div>
      </div>
    </div>
  `;
}

function closeHistoryCompareModal() {
  document.getElementById('history-compare-modal')?.classList.add('hidden');
}

// ============================================================================
// 11. Supabase 실시간 DB & GAS 클라우드 설정 모달 (교사 관리자 전용)
// ============================================================================
function openGasConfigModal() {
  const modal = document.getElementById('gas-config-modal');
  if (!modal) return;

  const sbUrlInput = document.getElementById('supabase-url-input');
  const sbKeyInput = document.getElementById('supabase-key-input');
  const gasUrlInput = document.getElementById('gas-url-input');
  const msgEl = document.getElementById('gas-config-status-msg');

  if (sbUrlInput) sbUrlInput.value = state.supabaseUrl || '';
  if (sbKeyInput) sbKeyInput.value = state.supabaseAnonKey || '';
  if (gasUrlInput) gasUrlInput.value = state.gasUrl || '';

  if (msgEl) {
    if (isSupabaseConfigured()) {
      msgEl.textContent = '⚡ 현재 Supabase 실시간 DB 및 MP4 영상 Storage가 활성화되어 있습니다.';
    } else if (isGasConfigured()) {
      msgEl.textContent = '☁️ 현재 Google Apps Script 시트 연동 중입니다. 위에 Supabase URL과 Anon Key를 입력하시면 초고속 실시간 DB 및 MP4 영상 공유가 활성화됩니다.';
    } else {
      msgEl.textContent = '💡 Supabase Project URL과 Anon Key를 입력하면 실시간 동기화 및 MP4 영상 파일 공유가 즉시 활성화됩니다.';
    }
  }
  modal.classList.remove('hidden');
}

function closeGasConfigModal() {
  document.getElementById('gas-config-modal')?.classList.add('hidden');
}

async function saveCloudConfig() {
  const sbUrl = (document.getElementById('supabase-url-input')?.value || '').trim();
  const sbKey = (document.getElementById('supabase-key-input')?.value || '').trim();
  const gasUrl = (document.getElementById('gas-url-input')?.value || '').trim();

  if (sbUrl && !sbUrl.startsWith('https://')) {
    showToast('올바른 Supabase Project URL(https://xxxx.supabase.co)을 입력해 주세요.', 'warning');
    return;
  }

  if (gasUrl && !gasUrl.startsWith('https://script.google.com/macros/s/')) {
    showToast('올바른 Google Apps Script 웹 앱 URL을 입력해 주세요.', 'warning');
    return;
  }

  state.supabaseUrl = sbUrl;
  state.supabaseAnonKey = sbKey;
  state.gasUrl = gasUrl || DEFAULT_GAS_WEB_APP_URL;

  localStorage.setItem(STORAGE_KEYS.SUPABASE_URL, sbUrl);
  localStorage.setItem(STORAGE_KEYS.SUPABASE_ANON_KEY, sbKey);
  localStorage.setItem(STORAGE_KEYS.GAS_WEB_APP_URL, state.gasUrl);

  initSupabaseClient();
  updateSyncStatusHeader();

  // 교사 PC에서 설정한 Supabase URL/Key를 GAS에도 저장하여 모든 학생 기기가 자동 공유받도록 함
  if (isGasConfigured() && sbUrl && sbKey) {
    try {
      fetch(state.gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'save_supabase_config',
          supabaseUrl: sbUrl,
          supabaseAnonKey: sbKey,
        }),
      }).catch(() => {});
    } catch {
      // ignore
    }
  }

  const msgEl = document.getElementById('gas-config-status-msg');
  if (isSupabaseConfigured()) {
    showToast('⚡ Supabase 실시간 DB 및 영상 Storage 설정이 저장되었습니다!', 'success');
    if (msgEl) {
      msgEl.textContent = '⚡ Supabase 설정 저장 완료! 연결 및 실시간 구독을 시작합니다...';
    }
    await pullFromCloudNow(false);
  } else if (isGasConfigured()) {
    showToast('☁️ 구글 시트 연동 설정이 저장되었습니다.', 'success');
    await pullFromCloudNow(false);
  } else {
    showToast('💾 로컬 스토리지 모드로 저장되었습니다.', 'info');
  }
}

function saveGasUrlConfig() {
  return saveCloudConfig();
}

async function testCloudConnection() {
  await saveCloudConfig();
  const msgEl = document.getElementById('gas-config-status-msg');

  if (isSupabaseConfigured() && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from(SUPABASE_TABLE)
        .select('student_id')
        .limit(1);

      if (error) {
        if (msgEl) {
          msgEl.textContent = `❌ Supabase 테이블 조회 오류 (${error.message}). 아래 [📋 Supabase 초기 설정 SQL 복사하기] 버튼을 눌러 SQL Editor에서 실행해 주세요!`;
        }
        showToast('Supabase 테이블(robot_expo_students)이 아직 생성되지 않았거나 권한 설정이 필요합니다.', 'warning');
        return;
      }

      if (msgEl) {
        msgEl.textContent = `✅ Supabase 연결 성공! robot_expo_students 테이블 및 실시간 채널과 정상 통신 중입니다.`;
      }
      showToast('✅ Supabase 실시간 DB 연결 테스트 성공!', 'success');
      return;
    } catch (err) {
      if (msgEl) {
        msgEl.textContent = `❌ Supabase 연결 실패: ${err.message || err}`;
      }
      return;
    }
  }

  if (isGasConfigured()) {
    const ok = await pullFromCloudNow(false);
    if (msgEl) {
      msgEl.textContent = ok
        ? '✅ 구글 스프레드시트 연결 성공! (Supabase 설정 입력 시 초고속 DB + MP4 영상 공유가 활성화됩니다)'
        : '❌ 연결 실패. 웹 앱 배포 권한을 확인해 주세요.';
    }
  }
}

const testGasConnection = testCloudConnection;

const SUPABASE_SETUP_SQL = `-- [2050 로봇 박람회] Supabase 테이블 및 영상 Storage 초기 설정 SQL
create table if not exists public.robot_expo_students (
  student_id text primary key,
  student_name text not null,
  status text not null default 'drafting',
  current_version integer not null default 0,
  teacher_feedback text default '',
  feedback_at text default '',
  updated_at text not null default '',
  inputs jsonb not null default '{}'::jsonb,
  video_prompt text default '',
  spec_sheet jsonb not null default '{}'::jsonb,
  video jsonb not null default '{"type":"none","url":"","fileName":""}'::jsonb,
  history jsonb not null default '[]'::jsonb,
  likes integer not null default 0,
  comments jsonb not null default '[]'::jsonb
);

alter table public.robot_expo_students enable row level security;

drop policy if exists "robot_expo_students_select_all" on public.robot_expo_students;
create policy "robot_expo_students_select_all" on public.robot_expo_students for select to anon, authenticated using (true);

drop policy if exists "robot_expo_students_insert_all" on public.robot_expo_students;
create policy "robot_expo_students_insert_all" on public.robot_expo_students for insert to anon, authenticated with check (true);

drop policy if exists "robot_expo_students_update_all" on public.robot_expo_students;
create policy "robot_expo_students_update_all" on public.robot_expo_students for update to anon, authenticated using (true) with check (true);

drop policy if exists "robot_expo_students_delete_all" on public.robot_expo_students;
create policy "robot_expo_students_delete_all" on public.robot_expo_students for delete to anon, authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'robot_expo_students'
  ) then
    alter publication supabase_realtime add table public.robot_expo_students;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('robot-videos', 'robot-videos', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime'])
on conflict (id) do update set public = true, file_size_limit = 52428800;

drop policy if exists "robot_videos_public_read" on storage.objects;
create policy "robot_videos_public_read" on storage.objects for select to anon, authenticated using (bucket_id = 'robot-videos');

drop policy if exists "robot_videos_public_insert" on storage.objects;
create policy "robot_videos_public_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'robot-videos');

drop policy if exists "robot_videos_public_update" on storage.objects;
create policy "robot_videos_public_update" on storage.objects for update to anon, authenticated using (bucket_id = 'robot-videos') with check (bucket_id = 'robot-videos');

drop policy if exists "robot_videos_public_delete" on storage.objects;
create policy "robot_videos_public_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'robot-videos');`;

async function copySupabaseSetupSql() {
  try {
    await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
    showToast('📋 Supabase 초기 설정 SQL이 복사되었습니다! Supabase SQL Editor에 붙여넣고 Run을 눌러주세요.', 'success');
  } catch {
    showToast('프로젝트 폴더 내 supabase_setup.sql 파일을 열어 복사해 주세요.', 'info');
  }
}

async function copyGasBackendCode() {
  try {
    const res = await fetch('google_apps_script.js');
    if (res.ok) {
      const code = await res.text();
      await navigator.clipboard.writeText(code);
      showToast('📋 google_apps_script.js 전체 코드가 복사되었습니다! 구글 시트 Apps Script에 붙여넣으세요.', 'success');
      return;
    }
  } catch {
    // ignore fetch error on file://
  }
  showToast('프로젝트 폴더 내 google_apps_script.js 파일의 코드를 복사하여 붙여넣어 주세요!', 'info');
}

// ============================================================================
// 12. 유틸리티 함수
// ============================================================================
function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(str) {
  if (!str) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
}

function formatDateTime(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const colorMap = {
    success: 'bg-slate-900 text-white border-emerald-500',
    warning: 'bg-amber-600 text-white border-amber-400',
    error: 'bg-rose-600 text-white border-rose-400',
    info: 'bg-slate-800 text-white border-blue-400',
  };

  const toast = document.createElement('div');
  toast.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-xl border-l-4 text-xs sm:text-sm font-bold flex items-center gap-2 transition-all duration-300 ${colorMap[type] || colorMap.info}`;
  toast.innerHTML = `<span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}
