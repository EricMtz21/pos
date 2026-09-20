// Comisiones de tarjeta (§7). Puro y en centavos.
//
// Reglas confirmadas con Eric (§14.1):
//  - El volumen que define el tramo se acumula por MES NATURAL.
//  - Sin IVA sobre la comisión (configurable de todos modos).
//  - La comisión es INFORMATIVA: reduce el neto del negocio, nunca lo que paga el cliente.

const CARD_METHODS = ['debit', 'credit']

export const isCardMethod = (method) => CARD_METHODS.includes(method)

/** Inicio del periodo acumulado, como texto local 'YYYY-MM-DD HH:MM:SS'. */
export function periodStart(period, now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === 'monthly') d.setDate(1)
  else if (period === 'weekly') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // lunes
  else if (period !== 'daily') throw new Error(`Periodo de comisión inválido: ${period}`)

  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 00:00:00`
}

/**
 * Tramo aplicable: aquel cuyo `min` es el mayor que no supera el volumen acumulado.
 * Devuelve el porcentaje, o 0 si no hay tramo que aplique.
 */
export function resolveRate(tiers = [], volume = 0) {
  return (
    [...tiers]
      .filter((t) => volume >= t.min)
      .sort((a, b) => a.min - b.min)
      .at(-1)?.pct ?? 0
  )
}

/**
 * Comisión de un cobro con tarjeta.
 * @param config  settings.cardCommission
 * @param method  'debit' | 'credit' | …
 * @param amount  importe cobrado con esa tarjeta, en centavos
 * @param volume  volumen con tarjeta ya acumulado en el periodo, ANTES de esta venta
 * @returns { rate, amount } — rate en porcentaje (4 = 4 %)
 */
export function calculateCommission({ config, method, amount, volume = 0 }) {
  if (!config?.enabled || !isCardMethod(method) || amount <= 0) return { rate: 0, amount: 0 }

  const rate = resolveRate(config.byMethod?.[method]?.tiers, volume)
  let commission = Math.round((amount * rate) / 100)
  if (config.applyIvaOnCommission) commission = Math.round(commission * 1.16)

  return { rate, amount: commission }
}

/** Valida el editor de tramos de Ajustes (§7). Devuelve un array de errores. */
export function validateTiers(tiers) {
  const errors = []
  if (!Array.isArray(tiers) || tiers.length === 0) return ['Debe haber al menos un tramo']
  if (!tiers.some((t) => t.min === 0)) errors.push('Falta el tramo inicial (min = 0)')

  tiers.forEach((t, i) => {
    if (!Number.isInteger(t.min) || t.min < 0) errors.push(`Tramo ${i + 1}: el mínimo debe ser un entero en centavos (>= 0)`)
    if (!(t.pct >= 0 && t.pct <= 100)) errors.push(`Tramo ${i + 1}: el porcentaje debe estar entre 0 y 100`)
    if (i > 0 && t.min <= tiers[i - 1].min) errors.push(`Tramo ${i + 1}: los mínimos deben ir en aumento`)
  })
  return errors
}
