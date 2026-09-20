import Database from 'better-sqlite3'
import { migrate } from './migrate.js'
import { migrations } from './migrations/index.js'
import { backupDatabase } from './backup.js'

/**
 * Abre (y crea si hace falta) la base, aplica migraciones pendientes y devuelve la conexión.
 * @param file       ruta al .sqlite, o ':memory:' en pruebas. Debe estar en userData, nunca dentro del asar.
 * @param backupDir  carpeta de respaldos; si se omite no se hace backup previo a migrar.
 */
export function openDatabase(file, { backupDir } = {}) {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  migrate(db, migrations, {
    beforeMigrate: () => backupDir && backupDatabase(db, backupDir, 'pre-migrate')
  })
  return db
}
