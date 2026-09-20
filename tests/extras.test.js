import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/main/db/connection.js'
import { createRepos } from '../src/main/db/repos/index.js'
import { hashPin, verifyPin } from '../src/main/db/repos/users.js'
import { can, deniedForCashier } from '../src/shared/business/permissions.js'
import { autoBackup } from '../src/main/auto-backup.js'
import { backupDatabase } from '../src/main/db/backup.js'
import { listBackups } from '../src/main/data-files.js'

const today = () => new Date().toLocaleDateString('en-CA')
const range = () => ({ from: today(), to: today() })

function setup() {
  const repos = createRepos(openDatabase(':memory:'))
  const refresco = repos.products.create({ name: 'Refresco', code: 'A', price_gross: 1800, stock: 100, tax_rate: 0.16 })
  const arroz = repos.products.create({ name: 'Arroz', code: 'B', price_gross: 2800, stock: 100, tax_rate: 0 })
  const venta = repos.sales.create({
    items: [
      { productId: refresco.id, qty: 3, unitPrice: 1800 },
      { productId: arroz.id, qty: 2, unitPrice: 2800 }
    ],
    payments: [{ method: 'cash', amount: 11000 }],
    cashReceived: 11000
  })
  return { repos, refresco, arroz, venta }
}

// ── Devoluciones ─────────────────────────────────────────────────────────────

test('devolución parcial: repone stock, no toca la venta y la deja abierta', () => {
  const { repos, refresco, venta } = setup()
  const linea = venta.items.find((i) => i.product_id === refresco.id)

  const dev = repos.returns.create({ saleId: venta.id, items: [{ saleItemId: linea.id, qty: 1 }], reason: 'defectuoso' })

  assert.match(dev.folio, /^D\d{8}-0001$/)
  assert.equal(dev.total, 1800)
  assert.equal(repos.products.get(refresco.id).stock, 98, 'se repone solo lo devuelto (100 - 3 + 1)')

  const sigue = repos.sales.get(venta.id)
  assert.equal(sigue.status, 'completed', 'una devolución parcial no cierra la venta')
  assert.equal(sigue.total, 11000, 'la venta original no se modifica')
  assert.equal(repos.products.moves(refresco.id)[0].type, 'return')
})

test('devolución total: la venta queda marcada como devuelta', () => {
  const { repos, venta } = setup()
  const dev = repos.returns.create({
    saleId: venta.id,
    items: venta.items.map((i) => ({ saleItemId: i.id, qty: i.qty }))
  })
  assert.equal(dev.total, 11000)
  assert.equal(repos.sales.get(venta.id).status, 'refunded')
})

test('devolución: no se puede devolver más de lo vendido, ni en dos intentos', () => {
  const { repos, venta } = setup()
  const linea = venta.items[0] // 3 unidades

  assert.throws(
    () => repos.returns.create({ saleId: venta.id, items: [{ saleItemId: linea.id, qty: 5 }] }),
    /solo quedan 3 por devolver/
  )

  repos.returns.create({ saleId: venta.id, items: [{ saleItemId: linea.id, qty: 2 }] })
  assert.throws(
    () => repos.returns.create({ saleId: venta.id, items: [{ saleItemId: linea.id, qty: 2 }] }),
    /solo quedan 1 por devolver/
  )
  // El intento rechazado no debe haber repuesto stock de más.
  assert.equal(repos.products.get(venta.items[0].product_id).stock, 99)
})

test('devolución: respeta el precio al que se vendió, no el actual', () => {
  const { repos, refresco, venta } = setup()
  repos.products.update(refresco.id, { price_gross: 5000 }) // subió de precio después
  const linea = venta.items.find((i) => i.product_id === refresco.id)
  const dev = repos.returns.create({ saleId: venta.id, items: [{ saleItemId: linea.id, qty: 1 }] })
  assert.equal(dev.total, 1800, 'se regresa lo que el cliente pagó')
})

test('devolución: reparte el descuento de la línea a prorrata', () => {
  const repos = createRepos(openDatabase(':memory:'))
  const p = repos.products.create({ name: 'X', price_gross: 1000, stock: 10 })
  const venta = repos.sales.create({
    items: [{ productId: p.id, qty: 4, unitPrice: 1000, discount: 400 }], // 4000 - 400 = 3600
    payments: [{ method: 'cash', amount: 3600 }]
  })
  const dev = repos.returns.create({ saleId: venta.id, items: [{ saleItemId: venta.items[0].id, qty: 2 }] })
  assert.equal(dev.total, 1800, 'la mitad de la línea ya descontada')
})

test('cancelar: una venta con devoluciones no se puede cancelar (repondría el stock dos veces)', () => {
  const { repos, refresco, venta } = setup()
  const linea = venta.items.find((i) => i.product_id === refresco.id)
  repos.returns.create({ saleId: venta.id, items: [{ saleItemId: linea.id, qty: 1 }] })
  assert.equal(repos.products.get(refresco.id).stock, 98)

  assert.throws(() => repos.sales.cancel(venta.id), /ya tiene devoluciones/)
  assert.equal(repos.products.get(refresco.id).stock, 98, 'el intento rechazado no repone nada')
  assert.equal(repos.sales.get(venta.id).status, 'completed')

  // El camino correcto es devolver lo que falta: la venta queda en cero y el stock cuadra.
  for (const i of repos.returns.returnableItems(venta.id).filter((i) => i.remaining > 0)) {
    repos.returns.create({ saleId: venta.id, items: [{ saleItemId: i.id, qty: i.remaining }] })
  }
  assert.equal(repos.sales.get(venta.id).status, 'refunded')
  assert.equal(repos.products.get(refresco.id).stock, 100, 'el stock vuelve exactamente al original')
})

test('devolución: una venta cancelada no admite devoluciones', () => {
  const { repos, venta } = setup()
  repos.sales.cancel(venta.id)
  assert.throws(
    () => repos.returns.create({ saleId: venta.id, items: [{ saleItemId: venta.items[0].id, qty: 1 }] }),
    /está cancelada/
  )
})

test('reportes: las devoluciones se restan del neto sin alterar el bruto', () => {
  const { repos, venta } = setup()
  const antes = repos.reports.summary(range())
  assert.equal(antes.gross, 11000)
  assert.equal(antes.returns, 0)

  repos.returns.create({ saleId: venta.id, items: [{ saleItemId: venta.items[0].id, qty: 1 }] })

  const despues = repos.reports.summary(range())
  assert.equal(despues.gross, 11000, 'el bruto refleja lo que se vendió')
  assert.equal(despues.returns, 1800)
  assert.equal(despues.net, antes.net - 1800, 'el neto sí baja: el dinero salió de la caja')
})

// ── Usuarios y permisos ──────────────────────────────────────────────────────

test('PIN: se guarda con sal y no en claro', () => {
  const hash = hashPin('1234')
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/)
  assert.ok(!hash.includes('1234'))
  assert.notEqual(hashPin('1234'), hashPin('1234'), 'dos hashes del mismo PIN deben diferir por la sal')

  assert.ok(verifyPin('1234', hash))
  assert.ok(!verifyPin('1235', hash))
  assert.ok(!verifyPin('1234', 'basura'))
  assert.ok(!verifyPin('1234', null))
})

test('usuarios: alta, autenticación y PIN inválido', () => {
  const { users } = createRepos(openDatabase(':memory:'))
  assert.equal(users.isAuthRequired(), false, 'sin usuarios no se pide PIN')

  const admin = users.create({ name: 'Eric', role: 'admin', pin: '4321' })
  assert.equal(admin.role, 'admin')
  assert.ok(!('pin_hash' in admin), 'el hash nunca sale del repositorio')
  assert.equal(users.isAuthRequired(), true)

  assert.equal(users.authenticate(admin.id, '4321').id, admin.id)
  assert.equal(users.authenticate(admin.id, '0000'), null)

  assert.throws(() => users.create({ name: 'Ana', role: 'cashier', pin: '12' }), /4 y 8 dígitos/)
  assert.throws(() => users.create({ name: 'Ana', role: 'cashier', pin: 'abcd' }), /4 y 8 dígitos/)
  assert.throws(() => users.create({ name: '', role: 'cashier', pin: '1234' }), /nombre es obligatorio/)
  assert.throws(() => users.create({ name: 'Ana', role: 'jefe', pin: '1234' }), /Rol inválido/)
})

test('usuarios: no se puede quedar sin administrador', () => {
  const { users } = createRepos(openDatabase(':memory:'))
  const admin = users.create({ name: 'Eric', role: 'admin', pin: '4321' })
  users.create({ name: 'Ana', role: 'cashier', pin: '1111' })

  assert.throws(() => users.deactivate(admin.id), /al menos un administrador/)
  assert.throws(() => users.update(admin.id, { role: 'cashier' }), /al menos un administrador/)

  // Con un segundo administrador sí se puede.
  const otro = users.create({ name: 'Luis', role: 'admin', pin: '2222' })
  assert.equal(users.deactivate(admin.id).active, 0)
  assert.throws(() => users.deactivate(otro.id), /al menos un administrador/)
})

test('usuarios: un usuario desactivado no puede entrar', () => {
  const { users } = createRepos(openDatabase(':memory:'))
  users.create({ name: 'Eric', role: 'admin', pin: '4321' })
  const ana = users.create({ name: 'Ana', role: 'cashier', pin: '1111' })
  users.deactivate(ana.id)
  assert.equal(users.authenticate(ana.id, '1111'), null)
})

test('permisos: el cajero vende pero no cambia precios ni ajustes', () => {
  assert.ok(can('cashier', 'sales:create'))
  assert.ok(can('cashier', 'cashCuts:create'))
  assert.ok(can('cashier', 'products:search'))
  assert.ok(can('cashier', 'ticket:print'))

  assert.ok(!can('cashier', 'products:update'))
  assert.ok(!can('cashier', 'products:adjustStock'))
  assert.ok(!can('cashier', 'settings:set'))
  assert.ok(!can('cashier', 'sales:cancel'))
  assert.ok(!can('cashier', 'returns:create'))
  assert.ok(!can('cashier', 'backup:restore'))
  assert.ok(!can('cashier', 'users:create'))
})

test('permisos: admin puede todo; sin usuarios tampoco hay restricciones', () => {
  for (const action of deniedForCashier()) {
    assert.ok(can('admin', action), `admin debería poder ${action}`)
    assert.ok(can(null, action), `sin usuarios debería poder ${action}`)
  }
  // Una sesión inexistente con usuarios dados de alta no puede nada.
  assert.ok(!can('nobody', 'sales:create'))
})

// ── Auditoría ────────────────────────────────────────────────────────────────

test('auditoría: queda registro del cambio de precio, con antes y después', () => {
  const repos = createRepos(openDatabase(':memory:'))
  const p = repos.products.create({ name: 'Café', price_gross: 5000, stock: 10 })
  repos.products.update(p.id, { price_gross: 6000 })

  const historial = repos.audit.list({ entity: 'product', entityId: p.id })
  assert.deepEqual(historial.map((h) => h.action), ['update', 'create'])

  const cambio = JSON.parse(historial[0].before_json)
  const despues = JSON.parse(historial[0].after_json)
  assert.equal(cambio.price_gross, 5000)
  assert.equal(despues.price_gross, 6000)
})

test('auditoría: los movimientos de inventario quedan con su motivo', () => {
  const repos = createRepos(openDatabase(':memory:'))
  const p = repos.products.create({ name: 'Café', price_gross: 5000, stock: 10 })
  repos.products.adjustStock({ productId: p.id, delta: -2, type: 'out', reason: 'merma' })

  const movimientos = repos.products.moves(p.id)
  assert.equal(movimientos[0].qty, -2)
  assert.equal(movimientos[0].reason, 'merma')
  assert.equal(movimientos[0].type, 'out')
})

// ── Respaldo automático ──────────────────────────────────────────────────────

test('respaldo automático: uno al día, no uno por arranque', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pos-auto-'))
  let db
  try {
    db = openDatabase(':memory:')
    const backup = (label) => backupDatabase(db, dir, label)

    const primero = autoBackup({ backupDir: dir, backup })
    assert.match(primero, /auto\.sqlite$/)
    assert.equal(listBackups(dir).length, 1)

    // Reabrir la app el mismo día no debe generar otro.
    assert.equal(autoBackup({ backupDir: dir, backup }), null)
    assert.equal(listBackups(dir).length, 1)

    // Al día siguiente sí.
    const mañana = Date.now() + 25 * 60 * 60 * 1000
    assert.ok(autoBackup({ backupDir: dir, backup, now: mañana }))
    assert.equal(listBackups(dir).length, 2)
  } finally {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('respaldo automático: un fallo al respaldar se propaga para poder avisarlo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pos-auto-'))
  try {
    assert.throws(
      () => autoBackup({ backupDir: dir, backup: () => { throw new Error('disco lleno') } }),
      /disco lleno/
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
