import { Router } from 'express'
import db from '../db.js'
import { bumpRevision } from '../lib/revision.js'

const router = Router()

// 방치 잠금 만료 시간(5분). 이보다 오래 하트비트가 없으면 없는 잠금으로 친다.
export const LOCK_TTL_MS = 5 * 60 * 1000

// 마이그레이션: 잠금 소유자를 계정이 아니라 "탭(client_id)" 단위로 구분한다.
// 같은 계정으로 창을 두 개 켜도 서로 다른 소유자가 되도록 client_id 컬럼을 추가.
// (기존 DB엔 컬럼이 없으므로 서버 시작 시 1회 안전하게 덧붙인다.)
try {
  const cols = db.prepare('PRAGMA table_info(bed_locks)').all()
  if (!cols.some((c) => c.name === 'client_id')) {
    db.exec('ALTER TABLE bed_locks ADD COLUMN client_id TEXT')
  }
} catch (err) {
  console.error('bed_locks client_id 마이그레이션 실패', err)
}

// 활성 잠금 = 최근 LOCK_TTL 안에 갱신된 것. 만료된 건 board가 무시하고 여기서 지운다.
function purgeExpired(now) {
  db.prepare('DELETE FROM bed_locks WHERE updated_at < ?').run(now - LOCK_TTL_MS)
}

function activeLock(bedCode, now) {
  return db.prepare(
    'SELECT account_id, client_id, updated_at FROM bed_locks WHERE bed_code = ? AND updated_at >= ?',
  ).get(bedCode, now - LOCK_TTL_MS)
}

// 등록 모달을 열 때 + 열려 있는 동안 주기적으로(하트비트) 호출한다.
// 남이 이미 활성 잠금을 쥐고 있으면 409 → 그 단말은 모달을 못 연다.
router.post('/bed-locks/:code', (req, res) => {
  const now = Date.now()
  const code = req.params.code
  const bed = db.prepare('SELECT code FROM beds WHERE code = ? AND is_active = 1').get(code)
  if (!bed) return res.status(404).json({ error: '존재하지 않는 베드입니다' })

  // 빈 베드에만 등록 잠금이 의미 있다. 이미 세션이 있으면(배정·진행) 잠금 대상 아님.
  const hasSession = db.prepare(
    'SELECT 1 FROM sessions WHERE bed_id = (SELECT id FROM beds WHERE code = ?) AND ended_at IS NULL AND cancelled = 0',
  ).get(code)
  if (hasSession) return res.status(409).json({ error: '이미 사용 중인 베드입니다' })

  // 소유자 판정 기준: 우선 client_id(탭), 없으면(구버전 클라이언트) 계정으로 폴백.
  const clientId = req.body?.clientId ?? null
  const existing = activeLock(code, now)
  const heldByOther = existing && (
    existing.client_id
      ? existing.client_id !== clientId
      : existing.account_id !== req.account.id
  )
  if (heldByOther) {
    return res.status(409).json({ error: '다른 사람이 등록 중입니다' })
  }

  // 내 잠금이거나 비어 있으면 획득/갱신(upsert).
  db.prepare(
    `INSERT INTO bed_locks (bed_code, account_id, client_id, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(bed_code) DO UPDATE SET account_id = excluded.account_id, client_id = excluded.client_id, updated_at = excluded.updated_at`,
  ).run(code, req.account.id, clientId, now)
  purgeExpired(now)

  // 처음 획득했을 때만 보드 리비전을 올려 다른 단말이 "등록중"을 빨리 보게 한다.
  // (하트비트마다 올리면 3초 폴링이 매번 리렌더된다.)
  if (!existing) bumpRevision(db)
  res.json({ ok: true })
})

// 모달을 닫거나(취소) 배정을 마쳤을 때 호출. 내 탭의 잠금만 푼다.
// (같은 계정의 다른 창이 쥔 잠금은 건드리지 않는다. 구버전 폴백: client_id가 없던 잠금은 계정 기준.)
router.delete('/bed-locks/:code', (req, res) => {
  const clientId = req.body?.clientId ?? null
  const info = db.prepare(
    `DELETE FROM bed_locks
     WHERE bed_code = ?
       AND (client_id = ? OR (client_id IS NULL AND account_id = ?))`,
  ).run(req.params.code, clientId, req.account.id)
  if (info.changes > 0) bumpRevision(db)
  res.json({ ok: true })
})

export default router
