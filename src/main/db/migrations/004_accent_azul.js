// El acento por defecto pasó de lima a azul. Quien nunca lo cambió tiene guardado el
// lima anterior, así que seguiría viendo los botones verdes tras actualizar: se migra.
// Solo se toca si coincide exactamente con el valor viejo; un color elegido a mano se respeta.
const LIMA_ANTERIOR = '#C7F04A'
const AZUL_NUEVO = '#3B82F6'

export default {
  version: 4,
  name: 'accent_azul',
  up(db) {
    db.prepare("UPDATE settings SET value = ? WHERE key = 'accent' AND lower(value) = lower(?)").run(
      JSON.stringify(AZUL_NUEVO),
      JSON.stringify(LIMA_ANTERIOR)
    )
  }
}
