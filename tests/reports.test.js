import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { openDatabase } from '../src/main/db/connection.js'
import { createRepos } from '../src/main/db/repos/index.js'
import { migrate, getSchemaVersion } from '../src/main/db/migrate.js'
import { migrations } from '../src/main/db/migrations/index.js'
import { buildWorkbook } from '../src/main/export-excel.js'

const today = () => new Date().toLocaleDateString('en-CA')
const range = () => ({ from: today(), to: today() })

function setup({ commission = false } = {}) {
  const repos = createRepos(openDatabase(':memory:'))
  if (commission) {
    repos.settings.set({
      cardCommission: {
        enabled: true, period: 'monthly', applyIvaOnCommission: false,
        byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] }, debit: { tiers: [{ min: 0, pct: 2 }] } }
      }
    })
  }
  const a = repos.products.create({ name: 'Refresco', code: 'A', price_gross: 1800, cost: 1100, stock: 1000, tax_rate: 0.16 })
  const b = repos.products.create({ name: 'Arroz', code: 'B', price_gross: 2800, cost: 2100, stock: 1000, tax_rate: 0 })
  return { repos, a, b }
}

// ── Migración 002 ────────────────────────────────────────────────────────────

test('migración 002: agrega la comisión por pago y reparte la ya registrada', () => {
  const db = new Database(':memory:')
  // Base en la versión 1, con una venta de pago mixto y comisión solo a nivel venta.
  migrate(db, [migrations[0]])
  db.exec(`
    INSERT INTO sales (id, folio, subtotal, total, payment_method, card_commission_rate,
                       card_commission_amount, net_total)
    VALUES (1, 'V1-0001', 10000, 10000, 'mixed', 4, 240, 9760);
    INSERT INTO payments (sale_id, method, amount) VALUES (1, 'cash', 4000), (1, 'credit', 4000), (1, 'debit', 2000);
  `)

  migrate(db, migrations)
  assert.equal(getSchemaVersion(db), 2)

  const pagos = db.prepare('SELECT method, amount, commission_amount FROM payments ORDER BY id').all()
  assert.equal(pagos.find((p) => p.method === 'cash').commission_amount, 0, 'el efectivo no paga comisión')
  // $240 repartidos entre $60 de tarjeta: $40 al crédito y $20 al débito.
  assert.equal(pagos.find((p) => p.method === 'credit').commission_amount, 160)
  assert.equal(pagos.find((p) => p.method === 'debit').commission_amount, 80)
  assert.equal(
    pagos.reduce((s, p) => s + p.commission_amount, 0),
    240,
    'el reparto suma exactamente la comisión de la venta'
  )
})

// ── Reportes ─────────────────────────────────────────────────────────────────

test('resumen: bruto, comisiones y neto del periodo', () => {
  const { repos, a, b } = setup({ commission: true })
  repos.sales.create({ items: [{ productId: a.id, qty: 2, unitPrice: 1800 }], payments: [{ method: 'cash', amount: 3600 }] })
  repos.sales.create({ items: [{ productId: b.id, qty: 1, unitPrice: 2800 }], payments: [{ method: 'credit', amount: 2800 }] })

  const s = repos.reports.summary(range())
  assert.equal(s.sales, 2)
  assert.equal(s.gross, 6400)
  assert.equal(s.commission, 112, '4 % de los $28 con crédito')
  assert.equal(s.net, 6288)
  assert.equal(s.averageTicket, 3200)
})

test('resumen: las ventas canceladas no cuentan', () => {
  const { repos, a } = setup()
  const venta = repos.sales.create({
    items: [{ productId: a.id, qty: 1, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 1800 }]
  })
  repos.sales.cancel(venta.id)
  assert.equal(repos.reports.summary(range()).sales, 0)
  assert.equal(repos.reports.summary(range()).gross, 0)
})

test('por método: el pago mixto se reparte y cada tarjeta lleva su propia comisión', () => {
  const { repos, a } = setup({ commission: true })
  // Débito al 2 % y crédito al 4 %: tasas distintas para comprobar que no se promedian.
  repos.sales.create({
    items: [{ productId: a.id, qty: 10, unitPrice: 1800 }],
    payments: [
      { method: 'cash', amount: 8000 },
      { method: 'debit', amount: 5000 },
      { method: 'credit', amount: 5000 }
    ],
    cashReceived: 8000
  })

  const byMethod = Object.fromEntries(repos.reports.byMethod(range()).map((m) => [m.method, m]))
  assert.equal(byMethod.cash.gross, 8000)
  assert.equal(byMethod.cash.commission, 0)
  assert.equal(byMethod.debit.commission, 100, '2 % de $50')
  assert.equal(byMethod.credit.commission, 200, '4 % de $50')
  assert.equal(byMethod.credit.net, 4800)

  const total = repos.reports.byMethod(range()).reduce((s, m) => s + m.gross, 0)
  assert.equal(total, 18000, 'los métodos suman el total de la venta')
  assert.equal(repos.reports.summary(range()).commission, 300)
})

test('productos: ranking por unidades, con el nombre actual del producto', () => {
  const { repos, a, b } = setup()
  repos.sales.create({ items: [{ productId: a.id, qty: 5, unitPrice: 1800 }], payments: [{ method: 'cash', amount: 9000 }] })
  repos.sales.create({ items: [{ productId: b.id, qty: 2, unitPrice: 2800 }], payments: [{ method: 'cash', amount: 5600 }] })

  // Renombrar el producto no debe partir el ranking en dos filas.
  repos.products.update(a.id, { name: 'Refresco de cola' })
  repos.sales.create({ items: [{ productId: a.id, qty: 1, unitPrice: 1800 }], payments: [{ method: 'cash', amount: 1800 }] })

  const top = repos.reports.topProducts(range())
  assert.equal(top.length, 2)
  assert.equal(top[0].name, 'Refresco de cola')
  assert.equal(top[0].qty, 6)
  assert.equal(top[0].total, 10800)
})

test('rango de fechas: excluye lo que queda fuera', () => {
  const { repos, a } = setup()
  repos.sales.create({ items: [{ productId: a.id, qty: 1, unitPrice: 1800 }], payments: [{ method: 'cash', amount: 1800 }] })
  const ayer = new Date(Date.now() - 86400000).toLocaleDateString('en-CA')
  assert.equal(repos.reports.summary({ from: ayer, to: ayer }).sales, 0)
  assert.equal(repos.reports.summary({ from: ayer, to: today() }).sales, 1)
})

// ── Corte de caja ────────────────────────────────────────────────────────────

test('corte: el esperado es fondo inicial + efectivo cobrado, y la diferencia el faltante', () => {
  const { repos, a } = setup()
  repos.sales.create({
    items: [{ productId: a.id, qty: 5, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 9000 }],
    cashReceived: 10000 // el cambio ya salió del cajón: no cambia lo esperado
  })
  repos.sales.create({ items: [{ productId: a.id, qty: 1, unitPrice: 1800 }], payments: [{ method: 'credit', amount: 1800 }] })

  const previa = repos.cashCuts.preview({ opening: 50000 })
  assert.equal(previa.cashSales, 9000, 'solo la parte cobrada en efectivo')
  assert.equal(previa.expectedCash, 59000)
  assert.equal(previa.sales, 2)

  const corte = repos.cashCuts.create({ opening: 50000, countedCash: 58500, notes: 'faltó un billete' })
  assert.equal(corte.expected_cash, 59000)
  assert.equal(corte.difference, -500, 'negativo = faltante')

  const sobra = repos.cashCuts.create({ opening: 50000, countedCash: 59500 })
  assert.equal(sobra.difference, 500, 'positivo = sobrante')
})

test('corte: el pago mixto aporta al cajón solo su parte en efectivo', () => {
  const { repos, a } = setup()
  repos.sales.create({
    items: [{ productId: a.id, qty: 10, unitPrice: 1800 }],
    payments: [{ method: 'cash', amount: 8000 }, { method: 'credit', amount: 10000 }],
    cashReceived: 8000
  })
  assert.equal(repos.cashCuts.preview({ opening: 0 }).expectedCash, 8000)
})

test('corte: rechaza importes que no sean centavos enteros positivos', () => {
  const { repos } = setup()
  assert.throws(() => repos.cashCuts.create({ opening: -1, countedCash: 0 }), /fondo inicial/)
  assert.throws(() => repos.cashCuts.create({ opening: 0, countedCash: 10.5 }), /efectivo contado/)
})

test('corte: se pueden registrar varios en el mismo día y queda el último como previo', () => {
  const { repos } = setup()
  repos.cashCuts.create({ opening: 10000, countedCash: 10000, notes: 'turno matutino' })
  const segundo = repos.cashCuts.create({ opening: 20000, countedCash: 20000, notes: 'turno vespertino' })
  assert.equal(repos.cashCuts.list().length, 2)
  assert.equal(repos.cashCuts.preview({}).previous.id, segundo.id)
})

// ── Exportación ──────────────────────────────────────────────────────────────

test('Excel: genera un archivo válido con todas las hojas y el dinero en pesos', async () => {
  const { repos, a } = setup({ commission: true })
  repos.sales.create({ items: [{ productId: a.id, qty: 2, unitPrice: 1800 }], payments: [{ method: 'credit', amount: 3600 }] })
  repos.cashCuts.create({ opening: 50000, countedCash: 50000 })

  const r = range()
  const book = buildWorkbook({
    ...r,
    summary: repos.reports.summary(r),
    byDay: repos.reports.byDay(r),
    byMethod: repos.reports.byMethod(r),
    topProducts: repos.reports.topProducts(r),
    sales: repos.reports.sales(r),
    cuts: repos.cashCuts.list(),
    business: { name: 'Mi Negocio' }
  })

  assert.deepEqual(
    book.worksheets.map((w) => w.name),
    ['Resumen', 'Ventas por día', 'Métodos de pago', 'Productos', 'Ventas', 'Cortes de caja']
  )

  // El dinero va en pesos, no en centavos, para que las fórmulas de Excel funcionen.
  const metodos = book.getWorksheet('Métodos de pago')
  assert.equal(metodos.getRow(2).getCell(1).value, 'Tarjeta crédito')
  assert.equal(metodos.getRow(2).getCell(3).value, 36)
  assert.equal(metodos.getRow(2).getCell(4).value, 1.44, '4 % de $36')
  assert.equal(metodos.getColumn(3).numFmt, '"$"#,##0.00')

  // Y el archivo debe poder escribirse de verdad.
  const buffer = await book.xlsx.writeBuffer()
  assert.ok(buffer.length > 1000, 'el archivo salió vacío')
  assert.equal(buffer.subarray(0, 2).toString('latin1'), 'PK', 'un .xlsx es un ZIP')
})

test('Excel: un periodo sin ventas genera un archivo abrible, no uno corrupto', async () => {
  const { repos } = setup()
  const r = { from: '2020-01-01', to: '2020-01-02' }
  const book = buildWorkbook({
    ...r,
    summary: repos.reports.summary(r),
    byDay: [], byMethod: [], topProducts: [], sales: [], cuts: [],
    business: { name: 'Mi Negocio' }
  })
  const buffer = await book.xlsx.writeBuffer()
  assert.ok(buffer.length > 1000)
  // Sin filas no debe quedar un autofiltro vacío: Excel lo reporta como archivo dañado.
  assert.ok(!book.getWorksheet('Productos').autoFilter)
})
