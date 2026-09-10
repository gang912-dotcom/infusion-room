import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'
import { assertInRange, isUniqueConstraintError, normalizeChartNo, normalizeGender } from '../lib/validation.js'
import { buildSessionRecord, attachSignatures, ROUTE_GROUP } from '../lib/record.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'

const router = Router()

// 진료실 번호 — 연속이 아니다(4·5진료실은 없음). 클라(App.jsx EXAM_ROOMS)와 같은 목록.
const EXAM_ROOMS = ['1', '2', '3', '6', '7']

// 미선택('')은 NULL로, 목록에 없는 값은 거부한다(호출부에서 400).
function normalizeExamRoom(value) {
  if (value === undefined || value === null || value === '') return null
  const room = String(value)
  return EXAM_ROOMS.includes(room) ? room : undefined
}

function getSetting(key) {
  return Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(key).value)
}

function getSessionOr404(id, res) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!session) {
    res.status(404).json({ error: '존재하지 않는 세션입니다' })
    return null
  }
  return session
}

// ─── 시작 시각 허용 범위 ─────────────────────────────────────────────
// 배정 시각보다 앞설 수 있다. 바빠서 **먼저 투여하고 등록을 나중에** 하는 경우가 있어
// 배정 시각을 하한으로 두면 그 정정이 막힌다(운영에서 실제로 걸렸다).
// 미래는 막는다. 하루보다 과거는 오타로 본다 — 오전/오후 혼동(05:15 ↔ 17:15)이
// 12시간 차이라 그대로 두면 진행률·이용시간이 통째로 틀어진다.
const STARTED_AT_MAX_BACK_MS = 24 * 60 * 60 * 1000

// 통과하면 true. 실패하면 응답까지 보내고 false를 준다.
function checkStartedAt(startedAt, res) {
  if (!Number.isFinite(startedAt)) {
    res.status(400).json({ error: '시작 시각이 올바르지 않습니다' })
    return false
  }
  const now = Date.now()
  if (startedAt > now) {
    res.status(400).json({ error: '시작 시각은 현재 시각보다 뒤일 수 없습니다' })
    return false
  }
  if (startedAt < now - STARTED_AT_MAX_BACK_MS) {
    res.status(400).json({ error: '시작 시각이 하루 이상 과거입니다 — 오전/오후를 확인해주세요' })
    return false
  }
  return true
}

// ─── assign — 라인실에서 베드 배정 ─────────────────────────────────
router.post('/sessions/assign', (req, res) => {
  const {
    bed_code, chart_no, patient_name, line_staff_id,
    special_note: specialNote, exam_room: examRoom, gender: rawGender,
    // 화면이 '이 번호 주인의 이름을 바꾼다'를 확인받았을 때만 true 로 온다(아래 409 참고).
    confirm_rename: confirmRename = false,
  } = req.body ?? {}
  // 아는 값이 아니면 null(미지정). 필수가 아니라 400으로 막지 않는다.
  const gender = normalizeGender(rawGender)
  if (!bed_code || !chart_no || !patient_name || !line_staff_id) {
    return res.status(400).json({ error: 'bed_code, chart_no, patient_name, line_staff_id가 모두 필요합니다' })
  }

  // 진료실은 라인 담당자와 같은 필수 항목이다(1단계에선 선택이었다가 필수로 바뀜).
  const normalizedExamRoom = normalizeExamRoom(examRoom)
  if (normalizedExamRoom === undefined) {
    return res.status(400).json({ error: '유효하지 않은 진료실입니다' })
  }
  if (normalizedExamRoom === null) {
    return res.status(400).json({ error: '진료실을 선택해주세요' })
  }

  const normalizedChartNo = normalizeChartNo(chart_no)
  if (normalizedChartNo === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const bed = db.prepare('SELECT id FROM beds WHERE code = ? AND is_active = 1').get(bed_code)
  if (!bed) return res.status(404).json({ error: '존재하지 않는 베드입니다' })

  const lineStaff = db.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1').get(line_staff_id)
  if (!lineStaff) return res.status(400).json({ error: '유효하지 않은 라인 담당자입니다' })

  const now = Date.now()
  let patient = db.prepare('SELECT id, name, gender FROM patients WHERE chart_no = ?').get(normalizedChartNo)
  if (patient) {
    // 이 번호의 주인 이름이 입력과 다르다 — 되묻기 전에는 절대 덮지 않는다.
    //
    // 예전엔 여기서 말없이 UPDATE 했다. 그래서 등록할 때 번호를 한 자리 잘못 치면
    // (71324 → 71334) 그 번호 주인의 이름이 조용히 바뀌었다. 환자 이름은 세션이 아니라
    // patients 행에 있으므로, 한 번 바뀌면 그 환자의 과거 방문까지 전부 남의 이름으로 보인다.
    // 2026-09-10 에 네 명이 이렇게 뒤바뀐 채 발견됐다(8/28 백업으로 되돌림).
    //
    // 대개는 번호 오타지 개명이 아니다 → 기본은 거절이고, 근무자가 화면에서 '이름을 바꾼다'를
    // 고른 경우에만 confirm_rename 이 실려 온다.
    if (patient.name !== patient_name && !confirmRename) {
      const visits = db.prepare(
        'SELECT COUNT(*) c FROM sessions WHERE patient_id = ? AND deleted = 0',
      ).get(patient.id).c
      return res.status(409).json({
        error: `차트번호 ${normalizedChartNo}는 ${patient.name} 환자입니다`,
        conflict: 'name_mismatch',
        chart_no: normalizedChartNo,
        registered_name: patient.name,
        typed_name: patient_name,
        visit_count: visits,
      })
    }
    if (patient.name !== patient_name) {
      db.prepare('UPDATE patients SET name = ?, updated_at = ? WHERE id = ?').run(patient_name, now, patient.id)
      logAccess(req, ACTIONS.PATIENT_RENAME, {
        targetType: 'patient',
        targetId: patient.id,
        detail: `배정 · ${normalizedChartNo} ${patient.name} → ${patient_name}`,
      })
    }
    // 성별은 값이 왔을 때만 쓴다. 미지정(null)을 그대로 덮으면 등록 모달이 성별을 못 채운
    // 경로로 저장될 때마다 기존 값이 조용히 지워진다. 바꾸려면 '남' 또는 '녀'를 고르면 된다.
    if (gender && gender !== patient.gender) {
      db.prepare('UPDATE patients SET gender = ?, updated_at = ? WHERE id = ?').run(gender, now, patient.id)
    }
  } else {
    const info = db.prepare(
      'INSERT INTO patients (chart_no, name, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(normalizedChartNo, patient_name, gender, now, now)
    patient = { id: info.lastInsertRowid }
  }

  // 같은 환자가 두 베드를 차지하면 안 된다. 최종 방어선은 db.js의 부분 유니크 인덱스지만
  // 그것만 있으면 근무자에게 SQLITE_CONSTRAINT가 그대로 보인다 — 여기서 읽을 수 있는 말로 돌려준다.
  // 조건은 그 인덱스와 똑같아야 한다(ended_at IS NULL AND cancelled = 0).
  // INSERT INTO sessions는 이 라우트 한 곳뿐이라 두 배정 경로가 모두 여기를 지난다.
  const activeElsewhere = db.prepare(`
    SELECT b.room, b.number FROM sessions s JOIN beds b ON b.id = s.bed_id
    WHERE s.patient_id = ? AND s.ended_at IS NULL AND s.cancelled = 0 LIMIT 1
  `).get(patient.id)
  if (activeElsewhere) {
    // 방 라벨은 클라가 붙인다(ROOM_LABELS가 정본) — active_bed를 함께 실어 보낸다.
    return res.status(409).json({
      error: `${patient_name} 환자는 이미 다른 베드에 배정돼 있습니다`,
      active_bed: { room: activeElsewhere.room, bed_number: activeElsewhere.number },
    })
  }

  let sessionId
  try {
    // 특이사항(기저질환)은 이 방문의 스냅샷으로 세션에 남기고, 정본은 환자에 쓴다.
    // 등록 칸은 정본이 프리필돼 있으므로 근무자가 고친 값이 곧 새 정본이다.
    // 빈 문자열은 NULL로 저장해 "없음"과 구분되지 않게 한다.
    const trimmedNote = typeof specialNote === 'string' ? specialNote.trim() : ''
    const info = db.transaction(() => {
      const created = db.prepare(
        `INSERT INTO sessions (bed_id, patient_id, assigned_at, assigned_by, line_staff_id, special_note, exam_room)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(bed.id, patient.id, now, req.account.id, lineStaff.id, trimmedNote || null, normalizedExamRoom)
      db.prepare('UPDATE patients SET baseline_note = ?, updated_at = ? WHERE id = ?')
        .run(trimmedNote || null, now, patient.id)
      return created
    })()
    sessionId = info.lastInsertRowid
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({ error: '이미 배정된 자리입니다' })
    }
    throw err
  }

  bumpRevision(db)
  const warning = Number(normalizedChartNo) > getSetting('chart_no_max')
    ? '차트번호가 상한을 초과했습니다'
    : undefined
  res.status(201).json({ id: sessionId, bed_code, chart_no: normalizedChartNo, assigned_at: now, warning })
})

// ─── patient — 배정 후 환자명/차트번호 정정 ─────────────────────────
router.patch('/sessions/:id/patient', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }

  const body = req.body ?? {}
  const { patient_name, chart_no, mode = null, confirm_rename: confirmRename = false } = body
  if (!patient_name || !chart_no) {
    return res.status(400).json({ error: 'patient_name, chart_no가 필요합니다' })
  }
  // 성별은 '보냈는지'와 '무엇을 보냈는지'를 나눠서 본다.
  // 안 보내면 건드리지 않고(옛 호출자 호환), 미지정('')을 보내면 진짜로 지운다.
  // 배정(assign)에서는 null이 기존 값을 덮지 않게 막았지만 여기는 반대다 —
  // 잘못 들어간 성별을 지울 방법이 이 화면뿐이다.
  const hasGender = Object.prototype.hasOwnProperty.call(body, 'gender')
  const gender = hasGender ? normalizeGender(body.gender) : null
  const normalizedChartNo = normalizeChartNo(chart_no)
  if (normalizedChartNo === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const current = db.prepare('SELECT id, chart_no, name FROM patients WHERE id = ?').get(session.patient_id)
  if (!current) return res.status(404).json({ error: '환자를 찾을 수 없습니다' })

  const chartChanged = current.chart_no !== normalizedChartNo
  const nameChanged = current.name !== patient_name
  const now = Date.now()

  // ─── 차트번호가 바뀌었다 — 두 가지 뜻이 될 수 있고, 앱은 어느 쪽인지 알 수 없다 ───
  //
  //   relink   : 이 베드에 등록된 환자가 애초에 딴 사람이었다(새로 꼬인 경우).
  //              → 과거 데이터는 옳으므로 건드리면 안 된다. 세션만 갈아 끼운다.
  //   renumber : 이 환자의 차트번호 자체가 틀렸다(원래 꼬여 있던 경우).
  //              → 과거 방문도 다 그 사람 것이므로 번호와 함께 따라가야 한다.
  //
  // 어느 쪽인지는 그때 상황을 아는 사람만 안다. 그래서 서버가 고르지 않는다 —
  // mode 없이 오면 판단 재료(양쪽 방문 건수·상대 환자)를 붙여 409로 되돌려주고,
  // 화면이 결과를 보여준 뒤 받아온 답을 다시 보낸다.
  if (chartChanged) {
    const target = db.prepare('SELECT id, chart_no, name FROM patients WHERE chart_no = ?').get(normalizedChartNo)
    const countVisits = db.prepare('SELECT COUNT(*) c FROM sessions WHERE patient_id = ? AND deleted = 0')

    if (mode !== 'relink' && mode !== 'renumber') {
      return res.status(409).json({
        error: '차트번호가 바뀝니다 — 어느 쪽인지 골라야 합니다',
        conflict: 'chart_changed',
        current: {
          chart_no: current.chart_no,
          name: current.name,
          visit_count: countVisits.get(current.id).c,
        },
        typed: { chart_no: normalizedChartNo, name: patient_name },
        // 그 번호를 이미 쓰는 환자가 있으면 relink 는 그 사람에게 붙는다.
        // 없으면 relink 가 새 환자를 만든다(target: null).
        target: target
          ? { chart_no: target.chart_no, name: target.name, visit_count: countVisits.get(target.id).c }
          : null,
      })
    }

    if (mode === 'renumber') {
      // 번호를 옮기려는데 그 번호를 이미 딴 사람이 쓰고 있으면 옮길 곳이 없다.
      if (target && target.id !== current.id) {
        return res.status(409).json({ error: `${normalizedChartNo}는 이미 ${target.name} 환자의 번호입니다` })
      }
      if (hasGender) {
        db.prepare('UPDATE patients SET name = ?, chart_no = ?, gender = ?, updated_at = ? WHERE id = ?')
          .run(patient_name, normalizedChartNo, gender, now, current.id)
      } else {
        db.prepare('UPDATE patients SET name = ?, chart_no = ?, updated_at = ? WHERE id = ?')
          .run(patient_name, normalizedChartNo, now, current.id)
      }
      logAccess(req, ACTIONS.PATIENT_RENUMBER, {
        targetType: 'patient',
        targetId: current.id,
        detail: `${current.chart_no} ${current.name} → ${normalizedChartNo} ${patient_name}`
          + ` (과거 방문 ${countVisits.get(current.id).c}건 동반)`,
      })
      bumpRevision(db)
      return res.json({ ok: true, mode: 'renumber' })
    }

    // relink — 그 번호의 환자를 찾거나 새로 만들어 세션만 갈아 끼운다.
    // 원래 환자 행은 이름도 번호도 건드리지 않는다. 그게 이 갈래의 전부다.
    let nextPatient = target
    if (nextPatient && nextPatient.name !== patient_name && !confirmRename) {
      return res.status(409).json({
        error: `차트번호 ${normalizedChartNo}는 ${nextPatient.name} 환자입니다`,
        conflict: 'name_mismatch',
        chart_no: normalizedChartNo,
        registered_name: nextPatient.name,
        typed_name: patient_name,
        visit_count: countVisits.get(nextPatient.id).c,
      })
    }
    try {
      db.transaction(() => {
        if (!nextPatient) {
          const info = db.prepare(
            'INSERT INTO patients (chart_no, name, gender, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          ).run(normalizedChartNo, patient_name, hasGender ? gender : null, now, now)
          nextPatient = { id: info.lastInsertRowid, chart_no: normalizedChartNo, name: patient_name }
        } else {
          if (nextPatient.name !== patient_name) {
            db.prepare('UPDATE patients SET name = ?, updated_at = ? WHERE id = ?')
              .run(patient_name, now, nextPatient.id)
            logAccess(req, ACTIONS.PATIENT_RENAME, {
              targetType: 'patient',
              targetId: nextPatient.id,
              detail: `환자정보수정 · ${normalizedChartNo} ${nextPatient.name} → ${patient_name}`,
            })
          }
          if (hasGender) {
            db.prepare('UPDATE patients SET gender = ?, updated_at = ? WHERE id = ?')
              .run(gender, now, nextPatient.id)
          }
        }
        db.prepare('UPDATE sessions SET patient_id = ? WHERE id = ?').run(nextPatient.id, session.id)
      })()
    } catch (err) {
      // 한 환자가 두 베드를 차지할 수 없다(db.js 의 부분 유니크 인덱스). 배정 라우트와
      // 같은 상황이므로 같은 말로 돌려준다 — 여기서만 SQLITE_CONSTRAINT 가 새면 안 된다.
      if (String(err?.code ?? '').startsWith('SQLITE_CONSTRAINT')) {
        return res.status(409).json({ error: `${patient_name} 환자는 이미 다른 베드에 배정돼 있습니다` })
      }
      throw err
    }
    logAccess(req, ACTIONS.PATIENT_RELINK, {
      targetType: 'session',
      targetId: session.id,
      detail: `세션 ${session.id}: ${current.chart_no} ${current.name} → ${normalizedChartNo} ${patient_name}`
        + ` (원래 환자의 과거 방문 ${countVisits.get(current.id).c}건은 그대로)`,
    })
    bumpRevision(db)
    return res.json({ ok: true, mode: 'relink' })
  }

  // ─── 번호는 그대로, 이름만 바뀐다 → 개명이다. 되묻고 남긴다 ───
  // 이 환자의 과거 방문까지 전부 새 이름으로 보이게 되므로 조용히 지나가면 안 된다.
  if (nameChanged && !confirmRename) {
    const visits = db.prepare(
      'SELECT COUNT(*) c FROM sessions WHERE patient_id = ? AND deleted = 0',
    ).get(current.id).c
    return res.status(409).json({
      error: `${current.chart_no} 환자의 이름을 바꿉니다`,
      conflict: 'rename',
      chart_no: current.chart_no,
      registered_name: current.name,
      typed_name: patient_name,
      visit_count: visits,
    })
  }

  if (hasGender) {
    db.prepare('UPDATE patients SET name = ?, gender = ?, updated_at = ? WHERE id = ?')
      .run(patient_name, gender, now, current.id)
  } else if (nameChanged) {
    db.prepare('UPDATE patients SET name = ?, updated_at = ? WHERE id = ?')
      .run(patient_name, now, current.id)
  }
  if (nameChanged) {
    logAccess(req, ACTIONS.PATIENT_RENAME, {
      targetType: 'patient',
      targetId: current.id,
      detail: `환자정보수정 · ${current.chart_no} ${current.name} → ${patient_name}`,
    })
  }
  // 카드에 이름·차트번호·성별이 실려 있어 다른 단말도 다시 받아야 한다.
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── start — 수액실에서 투여 시작 ───────────────────────────────────
router.post('/sessions/:id/start', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.cancelled) return res.status(400).json({ error: '취소된 배정입니다' })
  if (session.started_at !== null) return res.status(400).json({ error: '이미 시작된 세션입니다' })

  // 내원당시증상은 3a단계에서 '처방 확인'(PUT /sessions/:id/prescription)으로 옮겼다.
  // 투여 시작은 급할 때 먼저 눌러야 하므로 기록 입력과 엮지 않는다.
  // 믹스 담당자는 시작 시점에 비워둘 수 있다('추후 지정') — 라인 담당이 등록을 마치는 걸
  // 믹스할 사람이 정해질 때까지 붙잡아 두지 않으려는 것이다. 상세 모달에서 나중에 넣는다.
  // null(비움)과 키 누락은 다르게 본다: 키가 아예 없으면 거부한다. 안 그러면 클라이언트가
  // 필드를 빠뜨렸을 때 조용히 담당자 없는 세션이 생기고, 기록지의 믹스 서명 칸이 빈다.
  const { mix_staff_id, duration_minutes } = req.body ?? {}
  if (mix_staff_id === undefined) {
    return res.status(400).json({ error: '믹스 담당자 값이 없습니다' })
  }
  let mixStaffId = null
  if (mix_staff_id !== null) {
    const mixStaff = db.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1').get(mix_staff_id)
    if (!mixStaff) return res.status(400).json({ error: '유효하지 않은 믹스 담당자입니다' })
    mixStaffId = mixStaff.id
  }

  const minDuration = getSetting('min_duration_min')
  if (typeof duration_minutes !== 'number' || duration_minutes < minDuration) {
    return res.status(400).json({ error: `소요시간은 최소 ${minDuration}분 이상이어야 합니다` })
  }

  const now = Date.now()
  const startedAt = req.body?.started_at !== undefined ? Number(req.body.started_at) : now
  if (!checkStartedAt(startedAt, res)) return

  db.prepare(
    'UPDATE sessions SET started_at = ?, started_by = ?, mix_staff_id = ?, duration_minutes = ? WHERE id = ?',
  ).run(startedAt, req.account.id, mixStaffId, duration_minutes, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── bed — 베드 변경 ────────────────────────────────────────────────
router.patch('/sessions/:id/bed', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }

  const bed = db.prepare('SELECT id FROM beds WHERE code = ? AND is_active = 1').get(req.body?.bed_code)
  if (!bed) return res.status(404).json({ error: '존재하지 않는 베드입니다' })

  try {
    db.prepare('UPDATE sessions SET bed_id = ? WHERE id = ?').run(bed.id, session.id)
  } catch (err) {
    if (isUniqueConstraintError(err)) return res.status(409).json({ error: '이미 배정된 자리입니다' })
    throw err
  }
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── duration — 소요시간 조정 ───────────────────────────────────────
router.patch('/sessions/:id/duration', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작 전에는 소요시간을 조정할 수 없습니다' })
  }

  const { duration_minutes } = req.body ?? {}
  const minDuration = getSetting('min_duration_min')
  if (typeof duration_minutes !== 'number' || duration_minutes < minDuration) {
    return res.status(400).json({ error: `소요시간은 최소 ${minDuration}분 이상이어야 합니다` })
  }

  db.prepare('UPDATE sessions SET duration_minutes = ? WHERE id = ?').run(duration_minutes, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── started_at — 시작 시각 수정 (늦게 눌렀거나 잘못 입력한 경우 보정) ──
router.patch('/sessions/:id/started-at', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }
  if (session.started_at === null) {
    return res.status(400).json({ error: '아직 시작 전인 세션입니다' })
  }

  const startedAt = req.body?.started_at !== undefined ? Number(req.body.started_at) : NaN
  if (!checkStartedAt(startedAt, res)) return

  db.prepare('UPDATE sessions SET started_at = ? WHERE id = ?').run(startedAt, session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── cancel — 배정 취소 (라인 실패, 환자 복귀 등) ──────────────────
router.post('/sessions/:id/cancel', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '이미 종료되었거나 취소된 세션입니다' })
  }

  db.prepare('UPDATE sessions SET cancelled = 1, cancel_reason = ? WHERE id = ?')
    .run(req.body?.reason ?? null, session.id)

  // 이 등록이 만들어낸 환자였고 아무것도 안 남겼으면 흔적을 지운다.
  // 안 지우면 시험 삼아 등록했다 취소한 이름이 환자 검색에 영영 남는다(실제로 쌓였다).
  //
  // '이 등록이 만든 환자'는 정확히 가려낼 수 있다 — 환자 행과 세션 행이 같은 요청에서
  // 만들어져 created_at과 assigned_at이 같다. EMR에서 일괄 임포트한 환자는 환자가 먼저
  // 있었으니 두 값이 다르다. 그래서 '실제 환자인데 라인 실패로 취소된 경우'는 안 걸린다.
  //
  // 조건을 좁게 잡는다 — 하나라도 걸리면 아무것도 안 지운다. 지우는 건 되돌릴 수 없다.
  const cleaned = removeIfThrowawayPatient(session)
  bumpRevision(db)
  res.json({ ok: true, patient_removed: cleaned })
})

// 위 취소 경로에서만 쓴다. 지울 수 있으면 지우고 지웠는지 돌려준다.
function removeIfThrowawayPatient(session) {
  const patient = db.prepare('SELECT id, created_at FROM patients WHERE id = ?').get(session.patient_id)
  if (!patient) return false
  // 앱이 이 등록에서 만든 환자인가 (5초는 같은 요청 안의 오차 여유)
  if (Math.abs(patient.created_at - session.assigned_at) >= 5000) return false
  // 시작한 적이 있으면 남긴다 — 실제로 뭔가 있었던 방문이다
  if (session.started_at !== null) return false
  // 이 환자의 다른 세션이 있으면 남긴다
  const others = db.prepare(
    'SELECT COUNT(*) n FROM sessions WHERE patient_id = ? AND id <> ?',
  ).get(patient.id, session.id).n
  if (others > 0) return false
  // 이 세션에 붙은 기록이 하나라도 있으면 남긴다
  for (const t of ['rounds', 'session_notes', 'vitals', 'session_orders']) {
    if (db.prepare(`SELECT 1 FROM ${t} WHERE session_id = ? LIMIT 1`).get(session.id)) return false
  }
  // 환자에 붙은 기록이 있으면 남긴다
  if (db.prepare('SELECT 1 FROM patient_notes WHERE patient_id = ? LIMIT 1').get(patient.id)) return false

  db.transaction(() => {
    // session_notes가 없는 것을 위에서 확인했으므로 session_note_actions도 없다.
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id)
    db.prepare('DELETE FROM patients WHERE id = ?').run(patient.id)
  })()
  return true
}

// ─── end — 종료 → 이용기록으로 ─────────────────────────────────────
router.post('/sessions/:id/end', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at !== null || session.cancelled) {
    return res.status(400).json({ error: '이미 종료되었거나 취소된 세션입니다' })
  }
  if (session.started_at === null) {
    return res.status(400).json({ error: '시작되지 않은 세션은 종료할 수 없습니다. 배정 취소를 사용하세요' })
  }

  // 라인 제거 담당자는 라인·믹스 담당과 같은 필수 항목이다.
  const endStaff = db.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1')
    .get(req.body?.end_staff_id)
  if (!endStaff) {
    return res.status(400).json({ error: '라인 제거 담당자를 선택해주세요' })
  }

  const now = Date.now()
  const endedAt = req.body?.ended_at !== undefined ? Number(req.body.ended_at) : now
  try {
    assertInRange(endedAt, session.started_at, now, '종료 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  // 종료 처리와 스냅샷 저장을 한 트랜잭션에 묶는다 — 종료됐는데 공식본이 없는 상태가
  // 생기면 안 된다. 조립은 즉석 조회와 같은 함수를 쓴다(미리보기와 종료본이 어긋나지 않게).
  db.transaction(() => {
    db.prepare('UPDATE sessions SET ended_at = ?, ended_by = ?, end_staff_id = ? WHERE id = ?')
      .run(endedAt, req.account.id, endStaff.id, session.id)
    // 스냅샷은 end_staff_id가 들어간 뒤에 만들어야 라인 제거 담당자가 함께 굳는다.
    const record = buildSessionRecord(session.id)
    db.prepare('UPDATE sessions SET record_snapshot = ? WHERE id = ?').run(JSON.stringify(record), session.id)
  })()
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── history — 종료된 세션 목록(이용기록) ───────────────────────────
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT s.id, s.started_at, s.ended_at, s.deleted, s.special_note,
           s.exam_room, s.visit_symptom, s.duration_minutes,
           b.room, b.number AS bed_number,
           p.chart_no, p.name AS patient_name,
           ls.name AS line_staff_name, ms.name AS mix_staff_name,
           es.name AS end_staff_name, s.day_memo
    FROM sessions s
    JOIN beds b ON b.id = s.bed_id
    JOIN patients p ON p.id = s.patient_id
    LEFT JOIN staff ls ON ls.id = s.line_staff_id
    LEFT JOIN staff ms ON ms.id = s.mix_staff_id
    -- 라인 제거 담당자는 이 기능 이전 종료분엔 없다.
    -- 당일 메모는 그 방문 값이라 세션 컬럼이다 — 차트로 조인하던 구 환자 메모와 다르다.
    LEFT JOIN staff es ON es.id = s.end_staff_id
    WHERE s.ended_at IS NOT NULL
    ORDER BY s.ended_at DESC
  `).all()

  // 처방은 세션마다 조회하면 N+1이 된다 — 한 번에 받아 세션별로 묶는다.
  // 라벨 조인에 is_active 필터를 걸지 않는다(관리자가 숨긴 항목도 이름이 풀려야 한다).
  const orderRows = db.prepare(`
    SELECT so.session_id, so.item_code, so.dose, so.qty, oi.label, oi.route, oi.group_key
    FROM session_orders so
    LEFT JOIN order_items oi ON oi.code = so.item_code
    ORDER BY oi.group_key, oi.sort_order, so.dose
  `).all()
  const ordersBySession = new Map()
  for (const o of orderRows) {
    if (!ordersBySession.has(o.session_id)) ordersBySession.set(o.session_id, [])
    // route까지 싣는다 — CSV·환자 리포트의 처방 표기를 기록지와 같게 맞춘다.
    // 투여경로 그룹은 수량 개념이 없어 null로 보낸다(record.js와 같은 규칙).
    ordersBySession.get(o.session_id).push({
      label: o.label ?? o.item_code,
      dose: o.dose,
      qty: o.group_key === ROUTE_GROUP ? null : o.qty,
      route: o.route ?? null,
    })
  }

  res.json(rows.map((r) => ({ ...r, orders: ordersBySession.get(r.id) ?? [] })))
})

// ─── 종료 복귀 — 실수로 종료한 세션을 다시 이용 중으로 ────────────────
router.post('/sessions/:id/restore', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at === null) {
    return res.status(400).json({ error: '종료된 세션이 아닙니다' })
  }
  if (session.deleted) {
    return res.status(400).json({ error: '삭제된 기록은 복귀할 수 없습니다' })
  }

  // 그 사이 같은 베드에 새 환자가 들어왔으면 되돌릴 자리가 없다.
  // (DB의 idx_sessions_one_active가 막아주긴 하지만 메시지를 알아볼 수 있게 먼저 걸러낸다.)
  const occupied = db.prepare(
    'SELECT 1 FROM sessions WHERE bed_id = ? AND ended_at IS NULL AND cancelled = 0 LIMIT 1',
  ).get(session.bed_id)
  if (occupied) {
    return res.status(400).json({ error: '해당 베드에 다른 환자가 있어 복귀할 수 없습니다' })
  }

  // duration_minutes는 일부러 남긴다 — 이건 '투여 시작 때 정한 예정 소요시간'이고
  // 진행바·'N/120분' 표시가 쓴다. 지우면 복귀한 카드의 진행 표시가 깨진다.
  // (실제 이용시간은 저장하지 않고 ended_at - started_at으로 계산하므로 재종료 때 알아서 맞는다.)
  db.prepare(`
    UPDATE sessions
    SET ended_at = NULL, ended_by = NULL, end_staff_id = NULL, record_snapshot = NULL
    WHERE id = ?
  `).run(session.id)
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── 종료시각 사후 수정 ─────────────────────────────────────────────
// 바쁠 때 제때 못 눌러 실제보다 늦게 종료되는 일이 있다. 이용시간이 그대로 통계에
// 들어가므로 고칠 수 있어야 한다.
//
// 기록지 공식본(record_snapshot)에도 종료시각·이용시간이 굳어 있다 — 처방 사후 수정과
// 같은 이유로 여기서 다시 굳힌다. 안 그러면 이용기록 표(계산값)와 기록지가 다른 말을 한다.
router.patch('/sessions/:id/ended-at', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return
  if (session.ended_at === null) {
    return res.status(400).json({ error: '아직 종료되지 않은 세션입니다' })
  }
  if (session.deleted) {
    return res.status(400).json({ error: '삭제된 기록은 수정할 수 없습니다' })
  }

  const endedAt = Number(req.body?.ended_at)
  if (!Number.isFinite(endedAt)) {
    return res.status(400).json({ error: '종료 시각이 올바르지 않습니다' })
  }
  // 시작보다 빠르거나 미래인 값은 막는다 — 이용시간이 음수가 되거나 아직 오지 않은
  // 시각이 기록지에 인쇄된다.
  try {
    assertInRange(endedAt, session.started_at, Date.now(), '종료 시각')
  } catch (err) {
    return res.status(err.status).json({ error: err.message })
  }

  db.transaction(() => {
    db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?').run(endedAt, session.id)
    // 스냅샷이 없던 옛 종료분은 그대로 둔다(조회 때마다 즉석 조립이라 이미 새 값이다).
    if (session.record_snapshot) {
      db.prepare('UPDATE sessions SET record_snapshot = ? WHERE id = ?')
        .run(JSON.stringify(buildSessionRecord(session.id)), session.id)
    }
  })()

  logAccess(req, ACTIONS.RECORD_EDIT, { targetType: 'session', targetId: session.id })
  bumpRevision(db)
  res.json({ ok: true })
})

// ─── 기록지 조회 ────────────────────────────────────────────────────
// 종료됐으면 얼린 스냅샷을, 아니면 지금 DB로 즉석 조립한 것을 준다.
// 이 기능 이전에 종료된 세션은 스냅샷이 없으므로 즉석 조립으로 폴백한다(백필 불필요).
// 서명은 스냅샷에 없고 조회 시점의 직원 값을 붙인다 — 단건 조회라 base64가 실려도 된다.
router.get('/sessions/:id/record', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const record = session.record_snapshot
    ? JSON.parse(session.record_snapshot)
    : buildSessionRecord(session.id)
  if (!record) return res.status(404).json({ error: '기록지를 만들 수 없습니다' })

  res.json({ ...attachSignatures(record), from_snapshot: !!session.record_snapshot })
})

// ─── deleted 토글 — 이용기록 선택 삭제/복구(물리 삭제 아님) ─────────
router.patch('/sessions/:id', (req, res) => {
  const session = getSessionOr404(req.params.id, res)
  if (!session) return

  const {
    deleted, special_note: specialNote, exam_room: examRoom, visit_symptom: visitSymptom,
    day_memo: dayMemo, line_staff_id: lineStaffId, mix_staff_id: mixStaffId,
  } = req.body ?? {}
  if (deleted === undefined && specialNote === undefined
      && examRoom === undefined && visitSymptom === undefined && dayMemo === undefined
      && lineStaffId === undefined && mixStaffId === undefined) {
    return res.status(400).json({ error: '변경할 값이 없습니다' })
  }

  // 담당자는 진행 중인 세션에서만 바꾼다. 종료 세션의 기록지는 record_snapshot으로 얼어 있어
  // DB만 바뀌고 인쇄물은 그대로다. 기록지의 서명 이미지도 담당자 id로 붙으므로
  // 여기서 바꾸면 이름과 서명이 함께 바뀐다 — 그래서 더더욱 진행 중에만 허용한다.
  if ((lineStaffId !== undefined || mixStaffId !== undefined)
      && (session.ended_at !== null || session.cancelled)) {
    return res.status(400).json({ error: '종료되었거나 취소된 세션입니다' })
  }
  // 라인 담당자는 NOT NULL이라 다른 사람으로 바꿀 수만 있고 비울 수 없다.
  // 믹스 담당자도 비우기를 막는다 — 투여 시작 때 정해진 값이라 비우면 기록지에서 사라진다.
  // 비활성 직원으로는 바꿀 수 없다(이미 그 직원이 붙어 있는 과거 세션은 그대로 둔다).
  const activeStaffStmt = db.prepare('SELECT id FROM staff WHERE id = ? AND is_active = 1')
  for (const [value, label] of [[lineStaffId, '라인'], [mixStaffId, '믹스']]) {
    if (value === undefined) continue
    if (!Number.isInteger(value) || !activeStaffStmt.get(value)) {
      return res.status(400).json({ error: `유효하지 않은 ${label} 담당자입니다` })
    }
  }

  const normalizedExamRoom = normalizeExamRoom(examRoom)
  if (normalizedExamRoom === undefined) {
    return res.status(400).json({ error: '유효하지 않은 진료실입니다' })
  }
  // 정정은 다른 유효한 값으로만 가능하다 — 필수 항목이 된 이상 비우기는 막는다.
  // (진료실 없이 배정된 과거 세션은 그대로 두되, 여기서 값을 넣는 건 허용된다.)
  if (examRoom !== undefined && normalizedExamRoom === null) {
    return res.status(400).json({ error: '진료실은 비울 수 없습니다' })
  }

  const fields = []
  const params = []
  if (typeof deleted === 'boolean') { fields.push('deleted = ?'); params.push(deleted ? 1 : 0) }
  if (specialNote !== undefined) {
    const trimmed = typeof specialNote === 'string' ? specialNote.trim() : ''
    fields.push('special_note = ?')
    params.push(trimmed || null)
  }
  if (examRoom !== undefined) { fields.push('exam_room = ?'); params.push(normalizedExamRoom) }
  if (visitSymptom !== undefined) {
    const trimmed = typeof visitSymptom === 'string' ? visitSymptom.trim() : ''
    fields.push('visit_symptom = ?')
    params.push(trimmed || null)
  }
  if (dayMemo !== undefined) {
    const trimmed = typeof dayMemo === 'string' ? dayMemo.trim() : ''
    fields.push('day_memo = ?')
    params.push(trimmed || null)
  }
  if (lineStaffId !== undefined) { fields.push('line_staff_id = ?'); params.push(lineStaffId) }
  if (mixStaffId !== undefined) { fields.push('mix_staff_id = ?'); params.push(mixStaffId) }
  params.push(session.id)

  db.transaction(() => {
    db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`).run(...params)
    // 특이사항(기저질환)은 영구다 → 세션 스냅샷과 함께 환자 정본도 갱신한다.
    // 여기서 같이 쓰지 않으면 편집이 이 방문에만 남고 다음 방문에 사라진다.
    // 비우면 정본도 비워진다 — 지울 수 있어야 한다는 게 이번 개편의 핵심이다.
    if (specialNote !== undefined) {
      const trimmed = typeof specialNote === 'string' ? specialNote.trim() : ''
      db.prepare('UPDATE patients SET baseline_note = ?, updated_at = ? WHERE id = ?')
        .run(trimmed || null, Date.now(), session.patient_id)
    }
  })()
  // 특이사항·진료실·내원당시증상·당일 메모는 상세·카드에 바로 보여야 하므로
  // 다른 단말도 폴링으로 받게 revision을 올린다.
  if (specialNote !== undefined || examRoom !== undefined
      || visitSymptom !== undefined || dayMemo !== undefined
      || lineStaffId !== undefined || mixStaffId !== undefined) bumpRevision(db)
  res.json({ ok: true })
})

export default router
