import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase } from '../src/main/db/connection.js'
import { migrate, getSchemaVersion } from '../src/main/db/migrate.js'
import { migrations } from '../src/main/db/migrations/index.js'
import { backupDatabase } from '../src/main/db/backup.js'
import { createRepos } from '../src/main/db/repos/index.js'
import { seedSampleData } from '../src/main/db/seed.js'
import { SETTINGS_DEFAULTS } from '../src/shared/constants.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'pos-test-'))

test('migraciones: crea el esquema y es idempotente', () => {
  const db = new Database(':memory:')
  const first = migrate(db, migrations)
  assert.deepEqual(first.applied, migrations.map((m) => m.version))
  const second = migrate(db, migrations)
  assert.deepEqual(second.applied, [], 'correr de nuevo no aplica nada')
  assert.equal(getSchemaVersion(db), migrations.at(-1).version)
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schema_version').get().c, 1)

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name)
  for (const t of ['products', 'categories', 'sales', 'sale_items', 'payments', 'cash_cuts', 'inventory_moves', 'settings', 'audit_log', 'users', 'schema_version']) {
    assert.ok(tables.includes(t), `falta la tabla ${t}`)
  }
})

test('migraciones: una migración que falla no deja cambios ni sube la versión', () => {
  const db = new Database(':memory:')
  const last = migrations.at(-1).version
  const bad = [
    ...migrations,
    { version: last + 1, name: 'rota', up: (d) => { d.exec('CREATE TABLE tmp (id INTEGER)'); throw new Error('boom') } }
  ]
  assert.throws(() => migrate(db, bad), /boom/)
  assert.equal(getSchemaVersion(db), last, 'las migraciones buenas previas sí quedaron aplicadas')
  assert.equal(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name = 'tmp'").get().c, 0)
})

test('migraciones: rechaza huecos en las versiones', () => {
  const db = new Database(':memory:')
  assert.throws(() => migrate(db, [{ ...migrations[0], version: 2 }]), /Migraciones inválidas/)
})

test('backup previo a migrar: solo si la base ya tenía datos', () => {
  const dir = tmp()
  const file = join(dir, 'pos.sqlite')
  const backups = join(dir, 'backups')
  const current = migrations.at(-1).version
  let db
  try {
    openDatabase(file, { backupDir: backups }).close()
    assert.throws(() => readdirSync(backups), /ENOENT/, 'base nueva: no debe haber backup')

    // Simula una instalación ya al día a la que le llega una migración nueva.
    db = new Database(file)
    const next = { version: current + 1, name: 'extra', up: (d) => d.exec('CREATE TABLE extra (id INTEGER)') }
    let called = null
    migrate(db, [...migrations, next], {
      beforeMigrate: (info) => { called = info; backupDatabase(db, backups, 'pre-migrate') }
    })
    assert.deepEqual(called, { from: current, to: current + 1 })
    const files = readdirSync(backups)
    assert.equal(files.length, 1)
    assert.match(files[0], /pre-migrate\.sqlite$/)

    const copy = new Database(join(backups, files[0]), { readonly: true })
    assert.equal(getSchemaVersion(copy), current, 'el backup guarda el estado previo a migrar')
    copy.close()
  } finally {
    // Cerrar siempre: en Windows, un archivo abierto no se puede borrar (EBUSY).
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('backup: conserva solo los N más recientes', () => {
  const dir = tmp()
  try {
    const db = openDatabase(':memory:')
    for (let i = 0; i < 5; i++) backupDatabase(db, dir, `t${i}`, { keep: 3 })
    assert.equal(readdirSync(dir).length, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ajustes: defaults, persistencia y claves desconocidas', () => {
  const { settings } = createRepos(openDatabase(':memory:'))
  assert.equal(settings.get('theme'), 'system')
  settings.set({ theme: 'dark', lowStockThreshold: 10 })
  assert.equal(settings.get('theme'), 'dark')
  assert.equal(settings.get('lowStockThreshold'), 10)
  assert.equal(settings.get('accent'), SETTINGS_DEFAULTS.accent, 'lo no guardado cae al valor por defecto')
  assert.throws(() => settings.set({ inventada: 1 }), /desconocido/)
})

test('productos: CRUD, código único, búsqueda y baja lógica', () => {
  const repos = createRepos(openDatabase(':memory:'))
  const { products } = repos
  const p = products.create({ code: ' 123 ', name: ' Café ', price_gross: 5000, price_net: 4310, cost: 3000, stock: 10 })
  assert.equal(p.code, '123')
  assert.equal(p.name, 'Café')

  assert.throws(() => products.create({ code: '123', name: 'Otro' }), /Ya existe un producto con ese código/)
  assert.throws(() => products.create({ name: 'Malo', price_net: 10.5 }), /centavos/)
  // Varios productos sin código no deben chocar entre sí.
  products.create({ name: 'Sin código A' })
  products.create({ code: '', name: 'Sin código B' })

  assert.equal(products.findByCode('123').id, p.id)
  assert.equal(products.search({ text: 'caf' }).length, 1)

  products.update(p.id, { price_net: 4500 })
  assert.equal(products.get(p.id).price_net, 4500)

  products.deactivate(p.id)
  assert.equal(products.findByCode('123'), null)
  assert.equal(products.search({ text: 'caf' }).length, 0)
  assert.equal(products.search({ text: 'caf', includeInactive: true }).length, 1)
  assert.deepEqual(repos.audit.list({ entity: 'product', entityId: p.id }).map((a) => a.action), ['update', 'update', 'create'])
})

test('stock: alerta por umbral global o por producto, y movimientos atómicos', () => {
  const { products, settings } = createRepos(openDatabase(':memory:'))
  const a = products.create({ name: 'A', stock: 4 })               // usa umbral global (5)
  const b = products.create({ name: 'B', stock: 4, min_stock: 2 }) // umbral propio
  assert.deepEqual(products.lowStock().map((p) => p.name), ['A'])

  settings.set({ lowStockThreshold: 3 })
  assert.equal(products.lowStock().length, 0)

  const after = products.adjustStock({ productId: b.id, delta: -3, type: 'out', reason: 'merma' })
  assert.equal(after.stock, 1)
  assert.equal(after.low_stock, 1)
  assert.equal(products.moves(b.id)[0].qty, -3)

  assert.throws(() => products.adjustStock({ productId: a.id, delta: 0 }), /distinta de cero/)
  assert.throws(() => products.adjustStock({ productId: 999, delta: 1 }), /no encontrado/)
  assert.equal(products.get(a.id).stock, 4)
})

test('seed: solo inserta en una base sin productos', () => {
  const repos = createRepos(openDatabase(':memory:'))
  assert.equal(seedSampleData(repos), true)
  assert.equal(seedSampleData(repos), false)
  assert.ok(repos.products.search().length >= 5)
  assert.ok(repos.products.lowStock().length >= 1)
})
