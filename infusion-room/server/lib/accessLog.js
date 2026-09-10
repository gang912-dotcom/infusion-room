import db from '../db.js'

// 기록 대상은 아래 4가지뿐이다.
// 보드 폴링은 절대 넣지 않는다 — 3초 간격 × 단말 수면 하루 29만 건이 쌓여서
// 로그가 아니라 소음이 되고, 정작 봐야 할 접근 기록이 묻힌다.
export const ACTIONS = {
  LOGIN: 'login',
  PATIENT_VIEW: 'patient_view',
  ACCOUNT_CHANGE: 'account_change',
  // 쪽지 로그는 감사 기록인데 관리자가 지울 수 있게 됐다 — 지운 행위 자체는 남겨야 한다.
  MESSAGE_DELETE: 'message_delete',
  // 휴지통 완전삭제. 되돌릴 수 없으니 누가 언제 몇 건을 지웠는지는 반드시 남는다.
  SESSION_PURGE: 'session_purge',
  // 취소된 배정을 되살린 것. 없던 이용이 되살아나 통계·기록지에 다시 잡히므로 남긴다.
  SESSION_UNCANCEL: 'session_uncancel',
  // 종료된 세션의 처방을 사후에 고친 것. 공식본(record_snapshot)까지 다시 굳히는 행위라
  // 남긴다. 진행 중인 세션의 처방 저장은 일상 작업이라 기록하지 않는다(폴링과 같은 이유).
  RECORD_EDIT: 'record_edit',
  // 아직 앱에 내보내기 기능이 없다. 기능이 생기면 그 자리에서 이 값으로 기록하면 된다.
  EXPORT: 'export',
  // ─── 환자 신원이 바뀐 것 (2026-09-10) ───────────────────────────────
  // 차트번호 한 자리를 잘못 친 등록이 그 번호 주인의 이름을 조용히 덮어써서,
  // 네 명의 이름이 뒤바뀐 채 며칠을 갔다. 되돌릴 때 '언제 무엇이 무엇으로'가 없어
  // 백업 파일과 기록지 스냅샷을 일일이 대조해야 했다 — 그래서 남긴다.
  // detail 에 바뀐 내용을 사람이 읽을 수 있게 적는다.
  PATIENT_RENAME: 'patient_rename',      // 같은 차트번호, 이름만 바뀜
  PATIENT_RENUMBER: 'patient_renumber',  // 그 환자의 차트번호 자체가 바뀜(과거 기록 동반)
  PATIENT_RELINK: 'patient_relink',      // 이 세션만 다른 환자로 갈아 끼움
}

const insertStmt = db.prepare(
  `INSERT INTO access_logs (account_id, action, target_type, target_id, created_at, ip, actor, detail)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
)

function clientIp(req) {
  // 원내 LAN 직결이라 req.ip면 충분하다. IPv4-mapped(::ffff:192.168.0.5)는 보기 좋게 벗겨둔다.
  const ip = req?.ip ?? null
  return ip?.startsWith('::ffff:') ? ip.slice(7) : ip
}

// accountId를 따로 받는 이유: 로그인은 requireAuth를 안 거쳐서 req.account가 아직 없다.
//
// actor는 이 앱 계정이 아닌 사람이 봤을 때만 채운다(프렌즈에서 넘어온 열람 — '김철수#42').
// 그때 accountId는 프렌즈 서비스 계정이라 '어느 앱에서 왔나'까지만 답한다. 둘을 한 줄에
// 같이 남겨야 "프렌즈로 들어와서 김철수가 봤다"가 된다.
export function logAccess(
  req,
  action,
  { targetType = null, targetId = null, accountId, actor = null, detail = null } = {},
) {
  try {
    insertStmt.run(
      accountId ?? req?.account?.id ?? null,
      action,
      targetType,
      targetId != null ? Number(targetId) : null,
      Date.now(),
      clientIp(req),
      actor ?? req?.internal?.actor ?? null,
      detail,
    )
  } catch (err) {
    // 로그를 못 남긴다고 본 요청까지 실패시키지 않는다.
    console.error('접근 로그 기록 실패', err)
  }
}

// ─── 보존 기간 ──────────────────────────────────────────────────────
// 기본 1년. 진료 관련 접근 기록이라 짧게 잡을 이유가 없고, 양도 얼마 안 된다
// (로그인·환자조회·계정변경만 남기므로 하루 100건 남짓 → 1년에 4만 건 이하).
// 서버 PC에서 더 길게/짧게 두고 싶으면 ACCESS_LOG_RETENTION_DAYS 환경변수로 조정.
const RETENTION_DAYS = Number(process.env.ACCESS_LOG_RETENTION_DAYS) || 365
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export function pruneOldLogs() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * ONE_DAY_MS
    const { changes } = db.prepare('DELETE FROM access_logs WHERE created_at < ?').run(cutoff)
    if (changes > 0) console.log(`접근 로그 정리: ${changes}건 삭제(${RETENTION_DAYS}일 경과분)`)
    return changes
  } catch (err) {
    console.error('접근 로그 정리 실패', err)
    return 0
  }
}

// 서버가 며칠씩 켜져 있는 환경이라 시작 시 1회 + 이후 하루 1회.
export function scheduleLogPruning() {
  pruneOldLogs()
  const timer = setInterval(pruneOldLogs, ONE_DAY_MS)
  timer.unref?.()
  return timer
}
