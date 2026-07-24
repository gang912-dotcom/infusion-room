import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.join(__dirname, 'data')
fs.mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DB_PATH || path.join(dataDir, 'infusion.db')
const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8')
db.exec(schema)

export default db
