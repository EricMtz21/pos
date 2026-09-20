import Database from 'better-sqlite3'
import { copyFileSync, rmSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs'
import { extname, join, basename } from 'node:path'
import { backupDatabase } from './db/backup.js'
import { migrations } from './db/migrations/index.js'

const REQUIRED_TABLES = ['products', 'sales', 'sale_items', 'payments', 'settings', 'schema_version']
const LOGO_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']

/**
 * Comprueba que el archivo sea una base de este POS y que la app pueda abrirla.
 * Devuelve { version, sales, products } o lanza un error explicando por qué no sirve.
 */
export function inspectDatabaseFile(file) {
  let probe
  try {
    probe = new Database(file, { readonly: true, fileMustExist: true })
    const tables = new Set(probe.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name))
    const faltantes = REQUIRED_TABLES.filter((t) => !tables.has(t))
    if (faltantes.length > 0) {
      throw new Error(`El archivo no es una base de este POS (faltan tablas: ${faltantes.join(', ')})`)
    }

    const version = probe.prepare('SELECT version FROM schema_version').get()?.version ?? 0
    const supported = migrations.at(-1).version
    if (version > supported) {
      throw new Error(
        `El respaldo se creó con una versión más nueva de la aplicación (esquema ${version}, esta admite ${supported}). Actualiza el POS antes de restaurarlo.`
      )
    }

    return {
      version,
      sales: probe.prepare("SELECT COUNT(*) AS n FROM sales WHERE status = 'completed'").get().n,
      products: probe.prepare('SELECT COUNT(*) AS n FROM products').get().n
    }
  } catch (err) {
    if (err.code === 'SQLITE_NOTADB') throw new Error('El archivo no es una base de datos SQLite')
    if (err.code === 'SQLITE_CANTOPEN') throw new Error('No se pudo abrir el archivo')
    throw err
  } finally {
    probe?.close()
  }
}

export function listBackups(backupDir) {
  if (!existsSync(backupDir)) return []
  return readdirSync(backupDir)
    .filter((f) => f.endsWith('.sqlite'))
    .map((name) => {
      const { size, mtime } = statSync(join(backupDir, name))
      return { name, path: join(backupDir, name), size, createdAt: mtime.toISOString() }
    })
    .sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * Restaura la base desde un archivo. Antes de tocar nada:
 *  1. Valida el archivo.  2. Respalda la base actual.  3. Cierra la conexión.
 * Luego copia y pide reiniciar: la app entera trabaja sobre una conexión ya abierta.
 */
export function restoreDatabase({ source, dbPath, backupDir, db, closeDb }) {
  const info = inspectDatabaseFile(source)

  // El respaldo previo es lo que permite deshacer una restauración equivocada.
  const safety = backupDatabase(db, backupDir, 'pre-restore')
  closeDb()

  try {
    copyFileSync(source, dbPath)
    // Los diarios WAL del archivo anterior ya no corresponden a esta base.
    for (const suffix of ['-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  } catch (err) {
    // Si la copia falla, la base original sigue intacta en disco: solo se cerró la conexión.
    throw new Error(`No se pudo restaurar: ${err.message}. Tu base anterior sigue respaldada en ${safety}`)
  }

  return { ...info, safetyBackup: safety }
}

/** Copia el logo dentro de la carpeta de datos y devuelve su ruta definitiva. */
export function importLogo(source, dataDir) {
  const ext = extname(source).toLowerCase()
  if (!LOGO_EXTENSIONS.includes(ext)) {
    throw new Error(`Formato de imagen no admitido: ${ext || basename(source)}. Usa PNG, JPG o WEBP.`)
  }
  if (statSync(source).size > 2 * 1024 * 1024) throw new Error('El logo no debe pesar más de 2 MB')

  const dir = join(dataDir, 'assets')
  mkdirSync(dir, { recursive: true })
  // Nombre con marca de tiempo: al cambiar el logo, el ticket no se queda con el anterior en caché.
  const target = join(dir, `logo-${Date.now()}${ext}`)
  copyFileSync(source, target)

  // Se conserva solo el logo vigente.
  for (const old of readdirSync(dir)) {
    if (old.startsWith('logo-') && join(dir, old) !== target) rmSync(join(dir, old), { force: true })
  }
  return target
}
