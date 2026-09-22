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
  // Si otra cosa está escribiendo (un respaldo con VACUUM, el antivirus, una segunda
  // ventana), esperar medio segundo y reintentar en vez de fallar al instante. Sin esto,
  // SQLite devuelve SQLITE_BUSY de inmediato y la venta se cae por un bloqueo pasajero.
  db.pragma('busy_timeout = 5000')

  migrate(db, migrations, {
    beforeMigrate: () => backupDir && backupDatabase(db, backupDir, 'pre-migrate')
  })
  return db
}
