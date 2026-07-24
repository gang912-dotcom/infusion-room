export function getRevision(db) {
  return db.prepare('SELECT value FROM app_revision WHERE id = 1').get().value
}

export function bumpRevision(db) {
  db.prepare('UPDATE app_revision SET value = value + 1 WHERE id = 1').run()
  return getRevision(db)
}
