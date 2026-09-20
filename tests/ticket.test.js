import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderTicket, ticketToText, WIDTHS } from '../src/shared/business/ticket.js'

const sale = {
  folio: 'V20260919-0001',
  created_at: '2026-09-19 14:32:07',
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

const business = { name: 'Mi Negocio', address: 'Calle Falsa 123, Guadalajara', taxId: 'XAXX010101000', footer: '¡Gracias por su compra!' }

test('ticket: ninguna línea excede el ancho del papel', () => {
  for (const width of [58, 80]) {
    for (const line of renderTicket(sale, { business, width })) {
      assert.ok(line.length <= WIDTHS[width], `línea de ${line.length} en papel de ${width}mm: "${line}"`)
    }
  }
})

test('ticket: nombres largos se parten en vez de recortarse', () => {
  const largo = { ...sale, items: [{ ...sale.items[0], name_snapshot: 'Detergente líquido concentrado multiusos 1 litro' }] }
  const text = ticketToText(largo, { business, width: 58 })
  assert.ok(text.includes('Detergente'), 'falta el inicio del nombre')
  assert.ok(text.includes('litro'), 'el nombre se cortó en vez de partirse')
})

test('ticket: totales, cambio y datos del negocio', () => {
  const text = ticketToText(sale, { business })
  assert.match(text, /MI NEGOCIO/)
  assert.match(text, /RFC: XAXX010101000/)
  assert.match(text, /Folio: V20260919-0001/)
  assert.match(text, /Fecha: 19\/09\/2026 14:32/)
  assert.match(text, /TOTAL\s+\$62\.00/)
  assert.match(text, /Descuento\s+-\$2\.00/)
  assert.match(text, /IVA incluido\s+\$4\.97/)
  assert.match(text, /Recibido\s+\$100\.00/)
  assert.match(text, /Cambio\s+\$38\.00/)
  assert.match(text, /Gracias por su compra/)
})

test('ticket: no revela la comisión de tarjeta al cliente', () => {
  const conComision = {
    ...sale,
    payments: [{ method: 'credit', amount: 6200 }],
    cash_received: null,
    card_commission_rate: 4,
    card_commission_amount: 248,
    net_total: 5952
  }
  const text = ticketToText(conComision, { business })
  assert.match(text, /Tarjeta crédito\s+\$62\.00/, 'el cliente paga el total completo')
  assert.doesNotMatch(text, /[Cc]omisi[óo]n/)
  assert.doesNotMatch(text, /\$59\.52/, 'el neto del negocio no va en el ticket')
})

test('ticket: una venta cancelada se marca', () => {
  assert.match(ticketToText({ ...sale, status: 'cancelled' }, { business }), /VENTA CANCELADA/)
})

test('ticket: funciona sin datos de negocio configurados', () => {
  const text = ticketToText(sale, {})
  assert.match(text, /Folio:/)
  assert.match(text, /TOTAL/)
})

test('ticket: el pago mixto lista cada método', () => {
  const mixto = {
    ...sale,
    payments: [{ method: 'cash', amount: 4000 }, { method: 'credit', amount: 2200 }],
    cash_received: 4000,
    change_amount: 0
  }
  const text = ticketToText(mixto, { business })
  assert.match(text, /Efectivo\s+\$40\.00/)
  assert.match(text, /Tarjeta crédito\s+\$22\.00/)
})
