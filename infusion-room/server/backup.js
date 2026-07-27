// server/backup.js — SQLite 일관 스냅샷 백업 (7d)
//
// WAL 모드 DB를 단순 파일 복사하면 아직 본체(.db)에 반영 안 된 WAL 내용이 빠질 수 있다.
// 그래서 VACUUM INTO로 "현재 커밋된 상태 전체"를 단일 .db 파일로 떠낸다.
// (운영 서버가 DB를 열고 있어도 WAL 덕분에 동시 읽기가 안전하다.)
//
// 사용법:  node server/backup.js
//   BACKUP_DIR 환경변수로 목적지 변경 가능 (기본 D:\iv-backup)
//   DB_PATH    환경변수로 원본 DB 경로 변경 가능 (기본 server/data/infusion.db)

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const srcDb = process.env.DB_PATH || path.join(__dirname, 'data', 'infusion.db')
const backupDir = process.env.BACKUP_DIR || 'D:\\iv-backup'
const RETAIN_DAYS = 7

if (!fs.existsSync(srcDb)) {
  console.error(`[backup] 원본 DB를 찾을 수 없습니다: ${srcDb}`)
  process.exit(1)
}
fs.mkdirSync(backupDir, { recursive: true })

// 파일명: infusion-YYYY-MM-DD_HHmm.db  (로컬 시간)
const d = new Date()
const p2 = (n) => String(n).padStart(2, '0')
const stamp =
  `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` +
  `_${p2(d.getHours())}${p2(d.getMinutes())}`
const dest = path.join(backupDir, `infusion-${stamp}.db`)

// ─── 스냅샷 생성 ───────────────────────────────────────────────────
const db = new Database(srcDb)
try {
  // 경로 안의 작은따옴표는 SQL 문자열 규칙대로 이스케이프
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`)
} finally {
  db.close()
}
const kb = (fs.statSync(dest).size / 1024).toFixed(1)
console.log(`[backup] 생성 완료: ${dest} (${kb} KB)`)

// ─── 7일 순환: 보관 기간 지난 백업 삭제 ────────────────────────────
const cutoff = Date.now() - RETAIN_DAYS * 24 * 60 * 60 * 1000
let removed = 0
for (const f of fs.readdirSync(backupDir)) {
  if (!/^infusion-.*\.db$/.test(f)) continue
  const full = path.join(backupDir, f)
  if (fs.statSync(full).mtimeMs < cutoff) {
    fs.unlinkSync(full)
    removed++
  }
}
console.log(`[backup] 순환 정리: ${removed}개 삭제 (${RETAIN_DAYS}일 보관 정책)`)
