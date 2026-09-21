// Render del ticket como texto de ancho fijo. Puro y testeable: la impresión (o el PDF)
// solo envuelve estas líneas en una fuente monoespaciada.
import { formatMoney } from '../money.js'

// Caracteres que caben por línea en papel térmico, a fuente normal.
export const WIDTHS = { 58: 32, 80: 48 }

const PAYMENT_LABELS = {
  cash: 'Efectivo',
  debit: 'Tarjeta débito',
  credit: 'Tarjeta crédito',
  transfer: 'Transferencia',
  mixed: 'Pago mixto'
}

const center = (text, width) => {
  const t = text.slice(0, width)
  return ' '.repeat(Math.floor((width - t.length) / 2)) + t
}

/** Etiqueta a la izquierda, importe a la derecha, rellenando en medio. */
const leftRight = (left, right, width) => {
  const space = Math.max(1, width - right.length)
  const l = left.length > space - 1 ? left.slice(0, space - 1) : left
  return l.padEnd(space) + right
}

const rule = (width, char = '-') => char.repeat(width)

const wrap = (text, width) =>
  String(text)
    .split(/\s+/)
    .reduce((lines, word) => {
      const last = lines.at(-1)
      if (last && `${last} ${word}`.length <= width) lines[lines.length - 1] = `${last} ${word}`
      else lines.push(word.slice(0, width))
      return lines
    }, [])

const dateTime = (iso) => {
  const [date, time = ''] = String(iso).split(' ')
  const [y, m, d] = date.split('-')
  return `${d}/${m}/${y} ${time.slice(0, 5)}`
}

/**
 * @param sale      fila de `sales` con `items` y `payments`
 * @param business  settings.business
 * @param width     58 | 80 (mm)
 * @returns array de líneas de texto
 */
export function renderTicket(sale, { business = {}, width = 58 } = {}) {
  const w = WIDTHS[width] ?? WIDTHS[58]
  const lines = []

  if (business.name) lines.push(...wrap(business.name.toUpperCase(), w).map((l) => center(l, w)))
  if (business.address) lines.push(...wrap(business.address, w).map((l) => center(l, w)))
  if (business.taxId) lines.push(center(`RFC: ${business.taxId}`, w))
  if (business.phone) lines.push(center(`Tel. ${business.phone}`, w))

  lines.push(rule(w, '='))
  lines.push(`Folio: ${sale.folio}`)
  lines.push(`Fecha: ${dateTime(sale.created_at)}`)
  // Solo si la aplicación tiene usuarios: sin ellos no hay a quién atribuir la venta.
  if (sale.user_name) lines.push(...wrap(`Atendió: ${sale.user_name}`, w))
  if (sale.status === 'cancelled') lines.push(center('*** VENTA CANCELADA ***', w))
  lines.push(rule(w))

  for (const item of sale.items) {
    lines.push(...wrap(item.name_snapshot, w))
    const qty = Number.isInteger(item.qty) ? item.qty : item.qty.toFixed(3)
    lines.push(leftRight(`  ${qty} x ${formatMoney(item.unit_price)}`, formatMoney(item.line_total), w))
    if (item.discount > 0) lines.push(leftRight('  Descuento', `-${formatMoney(item.discount)}`, w))
  }

  lines.push(rule(w))
  lines.push(leftRight('Subtotal', formatMoney(sale.subtotal), w))
  if (sale.discount > 0) lines.push(leftRight('Descuento', `-${formatMoney(sale.discount)}`, w))
  lines.push(leftRight('TOTAL', formatMoney(sale.total), w))
  if (sale.tax > 0) lines.push(leftRight('IVA incluido', formatMoney(sale.tax), w))

  lines.push(rule(w))
  for (const p of sale.payments) lines.push(leftRight(PAYMENT_LABELS[p.method] ?? p.method, formatMoney(p.amount), w))
  if (sale.cash_received !== null) {
    lines.push(leftRight('Recibido', formatMoney(sale.cash_received), w))
    lines.push(leftRight('Cambio', formatMoney(sale.change_amount ?? 0), w))
  }

  // La comisión de tarjeta NO se imprime: es información del negocio, no del cliente (§14.1).

  if (business.footer) {
    lines.push(rule(w))
    lines.push(...wrap(business.footer, w).map((l) => center(l, w)))
  }
  lines.push('')
  return lines
}

export const ticketToText = (...args) => renderTicket(...args).join('\n')

/**
 * Venta ficticia representativa, para la vista previa de Ajustes: así se puede ver
 * cómo queda el ticket sin tener que cobrar algo de verdad. Lleva un artículo con
 * varias piezas, uno exento, descuento y cambio, que es donde más se nota el formato.
 */
export function sampleSale() {
  const ahora = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return {
    folio: `V${ahora.getFullYear()}${p(ahora.getMonth() + 1)}${p(ahora.getDate())}-0001`,
    created_at: `${ahora.getFullYear()}-${p(ahora.getMonth() + 1)}-${p(ahora.getDate())} ${p(ahora.getHours())}:${p(ahora.getMinutes())}:00`,
    status: 'completed',
    subtotal: 6400,
    discount: 200,
    tax: 497,
    total: 6200,
    cash_received: 10000,
    change_amount: 3800,
    card_commission_amount: 0,
    items: [
      { name_snapshot: 'Refresco cola 600ml', qty: 2, unit_price: 1800, discount: 0, line_total: 3600 },
      { name_snapshot: 'Arroz 1kg', qty: 1, unit_price: 2800, discount: 0, line_total: 2800 }
    ],
    payments: [{ method: 'cash', amount: 6200 }]
  }
}
