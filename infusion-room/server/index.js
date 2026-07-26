import express from 'express'
import cookieParser from 'cookie-parser'
import authRouter from './routes/auth.js'
import boardRouter from './routes/board.js'
import patientsRouter from './routes/patients.js'
import sessionsRouter from './routes/sessions.js'
import roundsRouter from './routes/rounds.js'
import notesRouter from './routes/notes.js'
import staffRouter from './routes/staff.js'
import adminRouter from './routes/admin.js'
import { requireAuth, requireAdmin } from './middleware/requireAuth.js'

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
app.use('/api/admin', requireAdmin, adminRouter)

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? 500
  res.status(status).json({ error: err.message ?? '서버 오류' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`server listening on :${PORT}`))
