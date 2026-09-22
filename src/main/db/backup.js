import { mkdirSync, readdirSync, unlinkSync, copyFileSync } from 'node:fs'
import { basename, join } from 'node:path'

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

/**
 * Copia el respaldo a una carpeta fuera de la aplicación: una USB, una carpeta
 * sincronizada, otro disco. Los respaldos automáticos viven junto a la base; si se muere
 * el disco se mueren los dos, y el negocio se queda sin nada.
 *
 * Devuelve la ruta de la copia, o lanza con un mensaje que se pueda enseñar: la USB puede
 * no estar puesta, y eso hay que decirlo, no tragárselo.
 */
export function copyBackupTo(file, folder, { keep = 20 } = {}) {
  if (!folder) return null
  try {
    mkdirSync(folder, { recursive: true })
    const destino = join(folder, basename(file))
    copyFileSync(file, destino)
    pruneBackups(folder, keep)
    return destino
  } catch (err) {
    throw new Error(`No se pudo copiar el respaldo a «${folder}»: ${err.message}`)
  }
}

// Conserva solo los `keep` respaldos más recientes (el nombre lleva la fecha, ordena solo).
function pruneBackups(dir, keep) {
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('pos-') && f.endsWith('.sqlite'))
    .sort()
  for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, f))
}
