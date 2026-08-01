import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cookieParser from 'cookie-parser'
import authRouter from './routes/auth.js'
import boardRouter from './routes/board.js'
import patientsRouter from './routes/patients.js'
import sessionsRouter from './routes/sessions.js'
import roundsRouter from './routes/rounds.js'
import notesRouter from './routes/notes.js'
import staffRouter from './routes/staff.js'
import bedLocksRouter from './routes/bedLocks.js'
import messagesRouter from './routes/messages.js'
import vitalsRouter from './routes/vitals.js'
import adminRouter from './routes/admin.js'
import { requireAuth, requireAdmin } from './middleware/requireAuth.js'
import { scheduleLogPruning } from './lib/accessLog.js'

const app = express()
app.use(express.json())
app.use(cookieParser())

app.use('/api', authRouter)

app.use('/api', requireAuth)
app.use('/api', boardRouter)
app.use('/api', patientsRouter)
app.use('/api', sessionsRouter)
app.use('/api', roundsRouter)
app.use('/api', notesRouter)
app.use('/api', staffRouter)
app.use('/api', bedLocksRouter)
app.use('/api', messagesRouter)
app.use('/api', vitalsRouter)
app.use('/api/admin', requireAdmin, adminRouter)

// ─── 프론트 정적 서빙 ───────────────────────────────────────────────
// dist/가 있으면(= npm run build 이후) 앱까지 같은 오리진에서 서빙한다 → 운영은 이 서버 하나만 띄우면 됨.
// dist/가 없으면(= 맥에서 개발 중) 이 블록 전체를 건너뛰고 API 전용으로 동작 —
// 그때는 기존대로 vite dev(5173)가 앱을 띄우고 /api만 이 서버로 프록시한다.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, '..', 'dist')
const indexHtml = path.join(distDir, 'index.html')

if (fs.existsSync(indexHtml)) {
  app.use(express.static(distDir))
  // SPA 폴백 — 새로고침이나 직접 URL 진입도 index.html로. /api는 위에서 이미 다 처리됐고,
  // 여기까지 온 /api 요청은 없는 엔드포인트라 HTML 대신 JSON 404를 줘야 한다.
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next()
    res.sendFile(indexHtml)
  })
  console.log(`정적 서빙: ${distDir}`)
} else {
  console.log('dist/ 없음 — API 전용 모드(개발). 앱은 vite dev 서버에서 띄우세요.')
}

app.use('/api', (req, res) => res.status(404).json({ error: '없는 API 엔드포인트입니다' }))

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? 500
  res.status(status).json({ error: err.message ?? '서버 오류' })
})

// 운영·개발 모두 4000. 개발 시 vite(5173)가 /api를 이 포트로 프록시한다(vite.config.js).
const PORT = process.env.PORT || 4000
app.listen(PORT, () => {
  console.log(`server listening on :${PORT}`)
  scheduleLogPruning()
})
