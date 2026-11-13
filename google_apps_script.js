/**
 * ============================================================================
 * 지속가능한 미래를 위한 2050 로봇 박람회 - Google Apps Script 백엔드 (안전성 강화 버전)
 * ============================================================================
 * - 전체 시트 삭제(clearContents) 코드 완전 제거 (개별 행 추가/수정/삭제만 수행)
 * - 동시 접속 충돌 방지를 위한 LockService 잠금 획득 검증 강화
 * -History_Log 누적 보존 및 Supabase 설정 자동 공유 지원
 */

const SHEET_STUDENTS = 'Students';
const SHEET_HISTORY = 'History_Log';

const STUDENT_HEADERS = [
  'student_id',        // 식별자 (이름)
  'student_name',      // 학생 이름 (예: 김미래)
  'status',            // 상태: drafting(작성중) | submitted(제출완료) | revision(수정요청) | approved(전시승인)
  'robot_name',        // 1-1. 로봇 이름
  'appearance',        // 1-2. 외형 특징
  'purpose',           // 2. 제작 목적
  'main_function',     // 3. 주요 기능
  'sensor_name',       // 4-1. 탑재 센서 이름
  'sensor_target',     // 4-2. 세부 감지 대상
  'sensor_action',     // 4-3. 감지 정보 활용 방법
  'science_tech',      // 5. 적용된 과학 기술
  'core_values',       // 6. 추구하는 가치 (해시태그)
  'video_style',       // 7. 영상 스타일
  'video_prompt',      // 변환된 AI 영상 프롬프트
  'spec_sheet_json',   // 변환된 개조식 기획서 JSON
  'teacher_feedback',  // 교사 피드백 메시지
  'feedback_at',       // 피드백 발송 시각
  'video_type',        // 첨부 영상 유형: none | url | local
  'video_url',         // 영상 URL
  'video_title',       // 영상 파일명/제목
  'likes',             // 전시관 응원 수
  'current_version',   // 현재 제출 버전 번호 (0, 1, 2...)
  'history_json',      // 버전별 누적 제출 이력 JSON 배열
  'updated_at'         // 최종 수정 시각 (ISO 8601)
];

const HISTORY_HEADERS = [
  'log_id',
  'student_name',
  'version',
  'submitted_at',
  'robot_name',
  'appearance',
  'purpose',
  'main_function',
  'sensor_name',
  'sensor_target',
  'sensor_action',
  'science_tech',
  'core_values',
  'video_style',
  'video_prompt',
  'teacher_feedback_before'
];

function getOrCreateSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let studentSheet = ss.getSheetByName(SHEET_STUDENTS);
  if (!studentSheet) {
    const active = ss.getActiveSheet();
    if (active && active.getLastRow() === 0) {
      active.setName(SHEET_STUDENTS);
      studentSheet = active;
    } else {
      studentSheet = ss.insertSheet(SHEET_STUDENTS);
    }
  }

  if (studentSheet.getLastRow() === 0) {
    studentSheet.appendRow(STUDENT_HEADERS);
    studentSheet.getRange(1, 1, 1, STUDENT_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#DBEAFE');
    studentSheet.setFrozenRows(1);
  }

  let historySheet = ss.getSheetByName(SHEET_HISTORY);
  if (!historySheet) {
    historySheet = ss.insertSheet(SHEET_HISTORY);
  }
  if (historySheet.getLastRow() === 0) {
    historySheet.appendRow(HISTORY_HEADERS);
    historySheet.getRange(1, 1, 1, HISTORY_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#FEF3C7');
    historySheet.setFrozenRows(1);
  }

  return { studentSheet, historySheet };
}

function getSharedSupabaseConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    return {
      supabaseUrl: props.getProperty('SUPABASE_URL') || '',
      supabaseAnonKey: props.getProperty('SUPABASE_ANON_KEY') || ''
    };
  } catch (e) {
    return { supabaseUrl: '', supabaseAnonKey: '' };
  }
}

function doGet(e) {
  try {
    const { studentSheet } = getOrCreateSheets();
    const rows = studentSheet.getDataRange().getValues();
    const supabaseConfig = getSharedSupabaseConfig();

    if (rows.length <= 1) {
      return responseJSON({
        success: true,
        students: [],
        supabaseConfig: supabaseConfig,
        serverTime: new Date().toISOString()
      });
    }

    const headers = rows[0];
    const students = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row[0] && !row[1]) continue;

      const raw = {};
      for (let j = 0; j < headers.length; j++) {
        raw[headers[j]] = row[j] !== undefined ? row[j] : '';
      }

      let history = [];
      try {
        history = raw.history_json ? JSON.parse(raw.history_json) : [];
      } catch (err) {
        history = [];
      }

      let specSheet = null;
      try {
        specSheet = raw.spec_sheet_json ? JSON.parse(raw.spec_sheet_json) : null;
      } catch (err) {
        specSheet = null;
      }

      const nameVal = String(raw.student_name || raw.student_id || '').trim();

      students.push({
        studentId: String(raw.student_id || nameVal).trim(),
        studentName: nameVal,
        status: String(raw.status || 'drafting').trim(),
        inputs: {
          robotName: String(raw.robot_name || ''),
          appearance: String(raw.appearance || ''),
          purpose: String(raw.purpose || ''),
          mainFunction: String(raw.main_function || ''),
          sensorName: String(raw.sensor_name || ''),
          sensorTarget: String(raw.sensor_target || ''),
          sensorAction: String(raw.sensor_action || ''),
          scienceTech: String(raw.science_tech || ''),
          coreValues: String(raw.core_values || ''),
          videoStyle: String(raw.video_style || '')
        },
        videoPrompt: String(raw.video_prompt || ''),
        specSheet: specSheet,
        teacherFeedback: String(raw.teacher_feedback || ''),
        feedbackAt: String(raw.feedback_at || ''),
        video: {
          type: String(raw.video_type || 'none'),
          url: String(raw.video_url || ''),
          title: String(raw.video_title || '')
        },
        likes: Number(raw.likes) || 0,
        currentVersion: Number(raw.current_version) || 0,
        history: history,
        updatedAt: String(raw.updated_at || new Date().toISOString())
      });
    }

    return responseJSON({
      success: true,
      students: students,
      supabaseConfig: supabaseConfig,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    return responseJSON({
      success: false,
      error: error.toString()
    });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  const hasLock = lock.tryLock(15000);
  if (!hasLock) {
    return responseJSON({
      success: false,
      error: 'SERVER_BUSY: 동시 요청이 많아 잠시 후 자동 재시도됩니다.'
    });
  }

  try {
    let payload = {};
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;
    const { studentSheet, historySheet } = getOrCreateSheets();

    if (action === 'save_supabase_config') {
      const props = PropertiesService.getScriptProperties();
      props.setProperty('SUPABASE_URL', String(payload.supabaseUrl || '').trim());
      props.setProperty('SUPABASE_ANON_KEY', String(payload.supabaseAnonKey || '').trim());
      return responseJSON({
        success: true,
        supabaseConfig: getSharedSupabaseConfig()
      });
    }

    if (action === 'upsert_student' || action === 'upsertStudent') {
      const student = payload.student;
      if (!student || (!student.studentId && !student.studentName)) {
        return responseJSON({ success: false, error: '학생 이름이 필요합니다.' });
      }

      upsertStudentRow(studentSheet, student);

      if (payload.newVersionEntry) {
        const v = payload.newVersionEntry;
        const vInputs = v.inputs || {};
        historySheet.appendRow([
          sanitizeSheetCell(String(student.studentName || student.studentId) + '_v' + String(v.version)),
          sanitizeSheetCell(student.studentName || student.studentId),
          Number(v.version) || 1,
          String(v.submittedAt || new Date().toISOString()),
          sanitizeSheetCell(vInputs.robotName),
          sanitizeSheetCell(vInputs.appearance),
          sanitizeSheetCell(vInputs.purpose),
          sanitizeSheetCell(vInputs.mainFunction),
          sanitizeSheetCell(vInputs.sensorName),
          sanitizeSheetCell(vInputs.sensorTarget),
          sanitizeSheetCell(vInputs.sensorAction),
          sanitizeSheetCell(vInputs.scienceTech),
          sanitizeSheetCell(vInputs.coreValues),
          sanitizeSheetCell(vInputs.videoStyle),
          sanitizeSheetCell(v.videoPrompt),
          sanitizeSheetCell(v.teacherFeedbackBefore)
        ]);
      }

      SpreadsheetApp.flush();
      return responseJSON({
        success: true,
        studentId: student.studentId || student.studentName,
        updatedAt: student.updatedAt
      });
    }

    // sync_all 요청이 들어오더라도 절대 clearContents()를 호출하지 않고 개별 행만 안전하게 병합(Upsert)합니다.
    if (action === 'sync_all' || action === 'syncAll') {
      const students = Array.isArray(payload.students) ? payload.students : [];
      students.forEach(function(st) {
        if (st && (st.studentId || st.studentName)) {
          upsertStudentRow(studentSheet, st);
        }
      });
      SpreadsheetApp.flush();

      return responseJSON({
        success: true,
        count: students.length,
        serverTime: new Date().toISOString()
      });
    }

    // 개별 학생 행만 안전하게 삭제 (clearContents 미사용)
    if (action === 'delete_student' || action === 'deleteStudent') {
      const targetId = String(payload.studentId || '').trim();
      if (!targetId) {
        return responseJSON({ success: false, error: '삭제할 학생 ID가 없습니다.' });
      }
      const rows = studentSheet.getDataRange().getValues();
      for (let i = rows.length - 1; i >= 1; i--) {
        if (String(rows[i][0]).trim() === targetId || String(rows[i][1]).trim() === targetId) {
          studentSheet.deleteRow(i + 1);
        }
      }
      SpreadsheetApp.flush();

      return responseJSON({
        success: true,
        deletedId: targetId
      });
    }

    return responseJSON({
      success: false,
      error: '알 수 없는 action: ' + action
    });
  } catch (error) {
    return responseJSON({
      success: false,
      error: error.toString()
    });
  } finally {
    lock.releaseLock();
  }
}

// 스프레드시트 수식 주입(Formula Injection: =, +, -, @) 방지 헬퍼
function sanitizeSheetCell(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (/^[=+\-@]/.test(str.trim())) {
    return "'" + str;
  }
  return str;
}

function studentToRow(student) {
  const inputs = student.inputs || {};
  const video = student.video || {};
  let safeVideoUrl = String(video.url || '');
  if (safeVideoUrl.length > 45000) {
    safeVideoUrl = 'LOCAL_INDEXED_DB';
  }
  const nameVal = String(student.studentName || student.studentId || '').trim();

  return [
    sanitizeSheetCell(String(student.studentId || nameVal).trim()),
    sanitizeSheetCell(nameVal),
    String(student.status || 'drafting'),
    sanitizeSheetCell(inputs.robotName),
    sanitizeSheetCell(inputs.appearance),
    sanitizeSheetCell(inputs.purpose),
    sanitizeSheetCell(inputs.mainFunction),
    sanitizeSheetCell(inputs.sensorName),
    sanitizeSheetCell(inputs.sensorTarget),
    sanitizeSheetCell(inputs.sensorAction),
    sanitizeSheetCell(inputs.scienceTech),
    sanitizeSheetCell(inputs.coreValues),
    sanitizeSheetCell(inputs.videoStyle),
    sanitizeSheetCell(student.videoPrompt),
    JSON.stringify(student.specSheet || null),
    sanitizeSheetCell(student.teacherFeedback),
    String(student.feedbackAt || ''),
    String(video.type || 'none'),
    sanitizeSheetCell(safeVideoUrl),
    sanitizeSheetCell(video.title),
    Number(student.likes) || 0,
    Number(student.currentVersion) || 0,
    JSON.stringify(student.history || []),
    String(student.updatedAt || new Date().toISOString())
  ];
}

function upsertStudentRow(sheet, student) {
  const rows = sheet.getDataRange().getValues();
  const targetId = String(student.studentId || student.studentName).trim();
  const rowValues = studentToRow(student);

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === targetId || String(rows[i][1]).trim() === targetId) {
      sheet.getRange(i + 1, 1, 1, STUDENT_HEADERS.length).setValues([rowValues]);
      return;
    }
  }

  sheet.appendRow(rowValues);
}

function responseJSON(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
