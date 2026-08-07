import { Router } from 'express'
import db from '../db.js'
import { normalizeChartNo } from '../lib/validation.js'
import { logAccess, ACTIONS } from '../lib/accessLog.js'

const router = Router()

router.get('/patients/lookup', (req, res) => {
  const normalized = normalizeChartNo(req.query.chart_no)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const patient = db.prepare(
    'SELECT id, chart_no, name, baseline_note, gender FROM patients WHERE chart_no = ?',
  ).get(normalized)
  if (!patient) {
    return res.json({ found: false, chart_no: normalized })
  }

  // 특이사항(기저질환)은 영구다 → 정본 컬럼을 그대로 준다.
  // 세션에서 '최신 non-null'을 찾던 옛 방식은 비워도 옛 값이 되살아나 삭제가 불가능했다.
  // 등록 모달이 이 값을 칸에 채우고, 값이 있으면 라인담당 지정 후 안내 모달이 뜬다.
  res.json({
    found: true,
    chart_no: patient.chart_no,
    name: patient.name,
    baseline_note: patient.baseline_note ?? null,
    // 등록 모달의 성별 드롭다운을 채운다. 이걸 안 주면 재방문마다 '미지정'으로 시작해
    // 저장할 때 기존 성별을 덮어쓸 위험이 생긴다(서버에서도 막지만 화면이 틀리게 보인다).
    gender: patient.gender ?? null,
  })
})

// ─── 환자 검색 — 배정 화면의 검색칸이 쓴다 ────────────────────────────
// lookup(차트번호 정확 일치)과 달리 이름으로도 찾는다. 차트번호를 모르는 경우가 이 기능의 이유다.
//
// 규칙은 '환자 조회' 탭과 같게 둔다: 이름은 부분 일치, 차트번호는 앞자리 일치.
// 번호를 부분 일치로 두면 '2444'가 '2244414' 가운데에 걸려 엉뚱한 환자가 섞인다.
// 이름에 숫자가 들어가는 경우가 없어 두 조건이 서로 섞이지 않는다.
//
// 대상은 patients 테이블이다. '환자 조회' 탭이 쓰는 GET /api/history는
// ended_at IS NOT NULL이라 오늘 처음 온 환자도 지금 이용 중인 환자도 안 나온다.
//
// 접근 로그는 남기지 않는다 — 목록만 보는 단계는 대상이 아니고,
// 상세를 열 때 아래 detail-view가 남긴다(기존 방침).
const SEARCH_LIMIT = 30

router.get('/patients/search', (req, res) => {
  const q = String(req.query.q ?? '').trim()
  if (!q) return res.json([])

  // 검색어에 든 LIKE 와일드카드(%, _)를 글자 그대로 찾게 막는다.
  const escaped = q.replace(/[\\%_]/g, '\\$&')

  // active 조건은 db.js의 idx_sessions_one_active_patient와 한 글자도 다르면 안 된다.
  // GROUP BY는 그 인덱스가 아직 없는 DB(위반이 남아 있는 경우)에서 한 환자가
  // 여러 줄로 나오지 않게 하는 보험이다.
  const rows = db.prepare(`
    SELECT p.chart_no, p.name, p.baseline_note, p.gender,
           b.room AS active_room, b.number AS active_bed_number
    FROM patients p
    LEFT JOIN sessions s
      ON s.patient_id = p.id AND s.ended_at IS NULL AND s.cancelled = 0
    LEFT JOIN beds b ON b.id = s.bed_id
    WHERE p.name LIKE ? ESCAPE '\\' OR p.chart_no LIKE ? ESCAPE '\\'
    GROUP BY p.id
    ORDER BY CAST(p.chart_no AS INTEGER), p.chart_no
    LIMIT ?
  `).all(`%${escaped}%`, `${escaped}%`, SEARCH_LIMIT)

  res.json(rows.map((r) => ({
    chart_no: r.chart_no,
    name: r.name,
    baseline_note: r.baseline_note ?? null,
    gender: r.gender ?? null,
    // 방 라벨('수액센터')은 서버에 두지 않는다 — 클라의 ROOM_LABELS가 정본이다.
    active: r.active_room ? { room: r.active_room, bed_number: r.active_bed_number } : null,
  })))
})

// 환자 조회 화면에서 특정 환자의 상세(이용이력·라운딩·특이사항·주의사항)를 열 때 프론트가 부른다.
// 상세 내용 자체는 이미 클라이언트가 들고 있는 데이터로 그리므로, 이 요청은 "누가 누구 기록을 열어봤나"를
// 남기는 용도다. 계정은 쿠키에서 서버가 직접 확인하므로(requireAuth) 클라이언트가 위조할 수 없다.
router.post('/patients/:chartNo/detail-view', (req, res) => {
  const normalized = normalizeChartNo(req.params.chartNo)
  if (normalized === null) {
    return res.status(400).json({ error: '차트번호는 숫자만 입력할 수 있습니다' })
  }

  const patient = db.prepare('SELECT id FROM patients WHERE chart_no = ?').get(normalized)
  if (!patient) return res.status(404).json({ error: '존재하지 않는 환자입니다' })

  logAccess(req, ACTIONS.PATIENT_VIEW, { targetType: 'patient', targetId: patient.id })
  res.json({ ok: true })
})

// ─── 은퇴: 환자 메모(patient_memos) ──────────────────────────────────
// 차트별 영구 메모였는데 2026-08-04 개편에서 성격이 갈렸다.
//   영구로 남길 것 → patients.baseline_note('특이사항(기저질환)' 정본)
//   그 방문만    → sessions.day_memo('당일 메모')
// 기존 데이터는 db.js가 baseline_note로 1회 이관했고(settings.baseline_note_migrated),
// patient_memos 테이블은 이관이 잘못됐을 때 돌아갈 원본으로 남겨둔다. 라우트만 없앤다.
//
// 테이블 이름 주의: patient_notes(은퇴한 구 '주의사항')와는 또 다른 테이블이다.

export default router
