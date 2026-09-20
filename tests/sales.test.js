import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openDatabase } from '../src/main/db/connection.js'
import { createRepos } from '../src/main/db/repos/index.js'
import { calculateTotals } from '../src/shared/business/totals.js'
import { calculateCommission, resolveRate, periodStart, validateTiers } from '../src/shared/business/commission.js'

// ── Totales ──────────────────────────────────────────────────────────────────

test('totales: el IVA se extrae del precio, no se suma', () => {
  const t = calculateTotals([
    { qty: 2, unitPrice: 1800, taxRate: 0.16 }, // 36.00
    { qty: 1, unitPrice: 2800, taxRate: 0 }     // 28.00 exento
  ])
  assert.equal(t.subtotal, 6400)
  assert.equal(t.total, 6400, 'el cliente paga el precio de lista')
  assert.equal(t.tax, 3600 - Math.round(3600 / 1.16), 'solo la línea gravada aporta IVA')
})

test('totales: descuento por línea y descuento de venta', () => {
  const t = calculateTotals([{ qty: 3, unitPrice: 1000, discount: 500, taxRate: 0.16 }], { discount: 250 })
  assert.equal(t.subtotal, 2500)
  assert.equal(t.discount, 250)
  assert.equal(t.total, 2250)
  assert.equal(t.tax, 2250 - Math.round(2250 / 1.16), 'el IVA se calcula sobre el importe ya descontado')
})

test('totales: el descuento prorrateado cuadra al centavo', () => {
  // Tres líneas iguales y un descuento que no divide exacto: 100 / 3.
  const t = calculateTotals(
    [
      { qty: 1, unitPrice: 1000, taxRate: 0.16 },
      { qty: 1, unitPrice: 1000, taxRate: 0.16 },
      { qty: 1, unitPrice: 1000, taxRate: 0.16 }
    ],
    { discount: 100 }
  )
  assert.equal(t.total, 2900)
  assert.equal(t.lines.reduce((s, l) => s + l.discountShare, 0), 100, 'el prorrateo suma el descuento exacto')
  // Sin centavos perdidos: el IVA corresponde al total realmente cobrado.
  assert.equal(t.tax, 2900 - Math.round(2900 / 1.16))
  assert.equal(t.tax, 400)
})

test('totales: con varias tasas, el IVA se calcula por tasa', () => {
  const t = calculateTotals([
    { qty: 1, unitPrice: 1000, taxRate: 0.16 },
    { qty: 1, unitPrice: 1000, taxRate: 0.16 },
    { qty: 1, unitPrice: 3000, taxRate: 0 }
  ])
  // Solo las dos primeras aportan IVA, y su base se suma antes de redondear.
  assert.equal(t.tax, 2000 - Math.round(2000 / 1.16))
})

test('totales: rechaza descuentos imposibles y topa el de venta', () => {
  assert.throws(() => calculateTotals([{ qty: 1, unitPrice: 1000, discount: 1500 }]), /no puede superar/)
  const t = calculateTotals([{ qty: 1, unitPrice: 1000 }], { discount: 99999 })
  assert.equal(t.total, 0)
  assert.equal(t.discount, 1000)
})

// ── Comisiones ───────────────────────────────────────────────────────────────

test('tramos: se aplica el mayor min que no supera el volumen', () => {
  const tiers = [{ min: 0, pct: 4 }, { min: 10000000, pct: 3 }]
  assert.equal(resolveRate(tiers, 0), 4)
  assert.equal(resolveRate(tiers, 9999999), 4)
  assert.equal(resolveRate(tiers, 10000000), 3, 'justo en el umbral ya aplica el tramo alto')
  assert.equal(resolveRate(tiers, 50000000), 3)
})

test('comisión: solo a tarjeta, y desactivada da cero', () => {
  const config = { enabled: true, period: 'monthly', byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] } } }
  assert.deepEqual(calculateCommission({ config, method: 'credit', amount: 10000 }), { rate: 4, amount: 400 })
  assert.deepEqual(calculateCommission({ config, method: 'cash', amount: 10000 }), { rate: 0, amount: 0 })
  assert.deepEqual(
    calculateCommission({ config: { ...config, enabled: false }, method: 'credit', amount: 10000 }),
    { rate: 0, amount: 0 }
  )
})

test('comisión: IVA sobre la comisión solo si se configura', () => {
  const base = { enabled: true, period: 'monthly', byMethod: { debit: { tiers: [{ min: 0, pct: 4 }] } } }
  assert.equal(calculateCommission({ config: base, method: 'debit', amount: 100000 }).amount, 4000)
  assert.equal(
    calculateCommission({ config: { ...base, applyIvaOnCommission: true }, method: 'debit', amount: 100000 }).amount,
    4640
  )
})

test('periodStart: mensual arranca el día 1', () => {
  assert.equal(periodStart('monthly', new Date(2026, 8, 19, 15, 30)), '2026-09-01 00:00:00')
  assert.equal(periodStart('daily', new Date(2026, 8, 19, 15, 30)), '2026-09-19 00:00:00')
  assert.equal(periodStart('weekly', new Date(2026, 8, 19)), '2026-09-14 00:00:00', 'sábado → lunes previo')
  assert.throws(() => periodStart('anual'), /inválido/)
})

test('validateTiers: mínimos ascendentes y porcentajes en rango', () => {
  assert.deepEqual(validateTiers([{ min: 0, pct: 4 }, { min: 10000000, pct: 3 }]), [])
  assert.match(validateTiers([{ min: 100, pct: 4 }])[0], /tramo inicial/)
  assert.ok(validateTiers([{ min: 0, pct: 4 }, { min: 0, pct: 3 }]).some((e) => /en aumento/.test(e)))
  assert.ok(validateTiers([{ min: 0, pct: 140 }]).some((e) => /entre 0 y 100/.test(e)))
})

// ── Venta completa ───────────────────────────────────────────────────────────

function setup() {
  const repos = createRepos(openDatabase(':memory:'))
  const producto = repos.products.create({
    name: 'Refresco', code: '111', price_gross: 1800, price_net: 1552, cost: 1100, stock: 10, tax_rate: 0.16
  })
  return { repos, producto }
}

test('venta en efectivo: descuenta stock, calcula cambio y genera folio', () => {
  const { repos, producto } = setup()
  const venta = repos.sales.create({
    items: [{ productId: producto.id, qty: 2, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 3600 }],
    cashReceived: 5000
  })

  assert.match(venta.folio, /^V\d{8}-0001$/)
  assert.equal(venta.total, 3600)
  assert.equal(venta.change_amount, 1400)
  assert.equal(venta.net_total, 3600, 'sin tarjeta no hay comisión')
  assert.equal(venta.items[0].name_snapshot, 'Refresco')
  assert.equal(repos.products.get(producto.id).stock, 8)
  assert.equal(repos.products.moves(producto.id)[0].qty, -2)

  const segunda = repos.sales.create({
    items: [{ productId: producto.id, qty: 1, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 1800 }]
  })
  assert.match(segunda.folio, /-0002$/, 'el folio avanza dentro del día')
})

test('venta: los pagos deben cuadrar exactamente con el total', () => {
  const { repos, producto } = setup()
  assert.throws(
    () => repos.sales.create({
      items: [{ productId: producto.id, qty: 1, unitPrice: 1800 }],
      payments: [{ method: 'cash', amount: 1700 }]
    }),
    /los pagos suman/i
  )
  assert.equal(repos.products.get(producto.id).stock, 10, 'una venta rechazada no toca el stock')
  assert.equal(repos.sales.list().length, 0)
})

test('venta: el efectivo recibido no puede ser menor al importe en efectivo', () => {
  const { repos, producto } = setup()
  assert.throws(
    () => repos.sales.create({
      items: [{ productId: producto.id, qty: 1, unitPrice: 1800 }],
      payments: [{ method: 'cash', amount: 1800 }],
      cashReceived: 1000
    }),
    /menor al importe/
  )
})

test('venta con tarjeta: guarda tasa y monto de comisión congelados', () => {
  const { repos, producto } = setup()
  repos.settings.set({
    cardCommission: {
      enabled: true, period: 'monthly', applyIvaOnCommission: false,
      byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] }, debit: { tiers: [{ min: 0, pct: 4 }] } }
    }
  })

  const venta = repos.sales.create({
    items: [{ productId: producto.id, qty: 5, unitPrice: 1800 }],
    payments: [{ method: 'credit', amount: 9000 }]
  })
  assert.equal(venta.total, 9000, 'el cliente paga el precio completo: la comisión no lo afecta')
  assert.equal(venta.card_commission_rate, 4)
  assert.equal(venta.card_commission_amount, 360)
  assert.equal(venta.net_total, 8640)

  // Cambiar la configuración después NO debe alterar la venta ya guardada.
  repos.settings.set({ cardCommission: { enabled: false, period: 'monthly', byMethod: {} } })
  assert.equal(repos.sales.get(venta.id).card_commission_amount, 360)
})

test('comisión: el tramo depende del volumen acumulado del mes, no de la venta', () => {
  const { repos, producto } = setup()
  repos.products.adjustStock({ productId: producto.id, delta: 100000, type: 'in' })
  repos.settings.set({
    cardCommission: {
      enabled: true, period: 'monthly', applyIvaOnCommission: false,
      byMethod: { debit: { tiers: [{ min: 0, pct: 4 }, { min: 500000, pct: 3 }] } }
    }
  })

  // Primera venta: $4,000 con débito. Volumen previo 0 → 4 %.
  const a = repos.sales.create({
    items: [{ productId: producto.id, qty: 1, unitPrice: 400000 }],
    payments: [{ method: 'debit', amount: 400000 }]
  })
  assert.equal(a.card_commission_rate, 4)
  assert.equal(a.card_commission_amount, 16000)

  // Segunda venta: el acumulado ya es $4,000 → sigue en 4 %.
  const b = repos.sales.create({
    items: [{ productId: producto.id, qty: 1, unitPrice: 200000 }],
    payments: [{ method: 'debit', amount: 200000 }]
  })
  assert.equal(b.card_commission_rate, 4)

  // Tercera: el acumulado ($6,000) ya superó el umbral → baja a 3 %.
  const c = repos.sales.create({
    items: [{ productId: producto.id, qty: 1, unitPrice: 100000 }],
    payments: [{ method: 'debit', amount: 100000 }]
  })
  assert.equal(c.card_commission_rate, 3)
  assert.equal(c.card_commission_amount, 3000)
})

test('pago mixto: solo la parte con tarjeta paga comisión', () => {
  const { repos, producto } = setup()
  repos.settings.set({
    cardCommission: {
      enabled: true, period: 'monthly', applyIvaOnCommission: false,
      byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] } }
    }
  })

  const venta = repos.sales.create({
    items: [{ productId: producto.id, qty: 5, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 4000 }, { method: 'credit', amount: 5000 }],
    cashReceived: 4000
  })
  assert.equal(venta.payment_method, 'mixed')
  assert.equal(venta.card_commission_amount, 200, '4 % de los $50 con tarjeta')
  assert.equal(venta.net_total, 8800)
  assert.equal(venta.payments.length, 2)
})

test('cancelar venta: repone stock y no se puede cancelar dos veces', () => {
  const { repos, producto } = setup()
  const venta = repos.sales.create({
    items: [{ productId: producto.id, qty: 3, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 5400 }]
  })
  assert.equal(repos.products.get(producto.id).stock, 7)

  const cancelada = repos.sales.cancel(venta.id, { reason: 'error de cobro' })
  assert.equal(cancelada.status, 'cancelled')
  assert.equal(repos.products.get(producto.id).stock, 10)
  assert.throws(() => repos.sales.cancel(venta.id), /ya no está activa/)
})

test('una venta cancelada no cuenta para el volumen de comisión', () => {
  const { repos, producto } = setup()
  repos.settings.set({
    cardCommission: { enabled: true, period: 'monthly', byMethod: { debit: { tiers: [{ min: 0, pct: 4 }] } } }
  })
  const venta = repos.sales.create({
    items: [{ productId: producto.id, qty: 1, unitPrice: 1800 }],
    payments: [{ method: 'debit', amount: 1800 }]
  })
  assert.equal(repos.sales.cardVolume('monthly'), 1800)
  repos.sales.cancel(venta.id)
  assert.equal(repos.sales.cardVolume('monthly'), 0)
})

test('venta: se puede vender aunque el stock quede negativo (el mostrador manda)', () => {
  const { repos, producto } = setup()
  const venta = repos.sales.create({
    items: [{ productId: producto.id, qty: 12, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 21600 }]
  })
  assert.equal(venta.status, 'completed')
  assert.equal(repos.products.get(producto.id).stock, -2)
})
