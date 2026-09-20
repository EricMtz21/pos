// Migrador versionado. Idempotente: solo corre las migraciones con versión mayor a la guardada
// en `schema_version`, cada una en su propia transacción junto con el cambio de versión.

export function getSchemaVersion(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
  return db.prepare('SELECT version FROM schema_version').get()?.version ?? 0
}

function assertValid(migrations) {
  migrations.forEach((m, i) => {
    if (m.version !== i + 1) {
      throw new Error(`Migraciones inválidas: se esperaba versión ${i + 1} y se encontró ${m.version}`)
    }
  })
}

/**
 * @param db           conexión better-sqlite3
 * @param migrations   [{ version, name, up(db) }] ordenadas y sin huecos
 * @param beforeMigrate  callback({ from, to }) que corre solo si hay migraciones pendientes
 *                       sobre una base que ya tenía datos (from > 0). Aquí va el backup.
 */
export function migrate(db, migrations, { beforeMigrate } = {}) {
  assertValid(migrations)
  const from = getSchemaVersion(db)
  const pending = migrations.filter((m) => m.version > from)
  if (pending.length === 0) return { from, to: from, applied: [] }

  const to = pending.at(-1).version
  if (from > 0) beforeMigrate?.({ from, to })

  const setVersion = db.prepare(
    'INSERT INTO schema_version (version) SELECT ? WHERE NOT EXISTS (SELECT 1 FROM schema_version)'
  )
  const bumpVersion = db.prepare('UPDATE schema_version SET version = ?')

  for (const m of pending) {
    db.transaction(() => {
      m.up(db)
      setVersion.run(m.version)
      bumpVersion.run(m.version)
    })()
  }
  return { from, to, applied: pending.map((m) => m.version) }
}
