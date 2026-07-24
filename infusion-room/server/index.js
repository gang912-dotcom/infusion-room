import express from 'express'
import cookieParser from 'cookie-parser'
import authRouter from './routes/auth.js'
import { requireAuth } from './middleware/requireAuth.js'

const app = express()
app.use(express.json())
app.use(cookieParser())

app.use('/api', authRouter)

app.use('/api', requireAuth)
// (이후 단계에서 board / patients / sessions / rounds·notes / admin 라우터가 여기 아래에 mount 됨)

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status ?? 500
  res.status(status).json({ error: err.message ?? '서버 오류' })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`server listening on :${PORT}`))
