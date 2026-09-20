// Todo el dinero se guarda y calcula en centavos (enteros) para evitar errores de coma flotante.
// Solo se convierte a pesos al mostrarlo o al leer lo que teclea el usuario.

export const toCents = (pesos) => Math.round(Number(pesos) * 100)

export const fromCents = (cents) => cents / 100

const formatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

export const formatMoney = (cents) => formatter.format(cents / 100)

/** Lee lo que teclea el usuario ('1,234.50', '$18', '18') y devuelve centavos, o null si no es válido. */
export function parseMoney(input) {
  const clean = String(input ?? '').replace(/[$\s,]/g, '')
  if (clean === '') return 0
  const value = Number(clean)
  return Number.isFinite(value) && value >= 0 ? toCents(value) : null
}

/**
 * El precio al público lleva el IVA incluido (decisión §14.4). El neto se deriva de él.
 * 1800 centavos con tasa 0.16 → 1552.
 */
export const netFromGross = (gross, taxRate) => Math.round(gross / (1 + taxRate))

/** Margen sobre el precio sin IVA, en porcentaje. Null si no hay costo o precio. */
export function margin(net, cost) {
  if (!net || !cost) return null
  return ((net - cost) / net) * 100
}
