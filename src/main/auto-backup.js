import { listBackups } from './data-files.js'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Respaldo automático al arrancar (§5.5), como mucho uno al día.
 * Se apoya en la fecha del archivo más reciente: no hace falta guardar estado aparte.
 *
 * @returns la ruta del respaldo creado, o null si hoy ya había uno.
 */
export function autoBackup({ backupDir, backup, now = Date.now(), everyMs = DAY_MS }) {
  const último = listBackups(backupDir)[0]
  if (último && now - new Date(último.createdAt).getTime() < everyMs) return null
  return backup('auto')
}
