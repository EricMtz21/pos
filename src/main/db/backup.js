import { mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '')

/**
 * Copia consistente de la base con `VACUUM INTO` (síncrono, seguro con la base abierta).
 * Devuelve la ruta del respaldo. `label` distingue el origen: 'pre-migrate', 'corte', 'manual'.
 */
export function backupDatabase(db, dir, label = 'manual', { keep = 20 } = {}) {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `pos-${stamp()}-${label}.sqlite`)
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
  pruneBackups(dir, keep)
  return file
}

// Conserva solo los `keep` respaldos más recientes (el nombre lleva la fecha, ordena solo).
function pruneBackups(dir, keep) {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('pos-') && f.endsWith('.sqlite'))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, f))
}
