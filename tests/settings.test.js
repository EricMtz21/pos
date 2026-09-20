import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { openDatabase } from '../src/main/db/connection.js'
import { createRepos } from '../src/main/db/repos/index.js'
import { validateSettings } from '../src/shared/business/settings-validate.js'
import { inspectDatabaseFile, restoreDatabase, listBackups, importLogo } from '../src/main/data-files.js'
import { migrations } from '../src/main/db/migrations/index.js'

const tmp = () => mkdtempSync(join(tmpdir(), 'pos-set-'))

const commission = (over = {}) => ({
  enabled: true,
  period: 'monthly',
  applyIvaOnCommission: false,
  byMethod: {
    credit: { tiers: [{ min: 0, pct: 4 }] },
    debit: { tiers: [{ min: 0, pct: 4 }] }
  },
  ...over
})

// ── Validación ───────────────────────────────────────────────────────────────

test('validación: acepta una configuración correcta', () => {
  assert.deepEqual(
    validateSettings({
      theme: 'dark',
      accent: '#C7F04A',
      lowStockThreshold: 5,
      business: { name: 'Mi Negocio', address: '', taxId: '', phone: '', footer: 'Gracias' },
      ticket: { width: 58, autoPrint: false, printer: '' },
      cardCommission: commission()
    }),
    []
  )
})

test('validación: rechaza valores imposibles con mensajes legibles', () => {
  assert.match(validateSettings({ theme: 'neón' })[0], /Tema inválido/)
  assert.match(validateSettings({ accent: 'rojo' })[0], /#RRGGBB/)
  assert.match(validateSettings({ accent: '#GGG' })[0], /#RRGGBB/)
  assert.match(validateSettings({ lowStockThreshold: -3 })[0], /mayor o igual a cero/)
  assert.match(validateSettings({ ticket: { width: 72 } })[0], /58 u 80/)
  assert.match(validateSettings({ business: { name: '   ' } })[0], /no puede quedar vacío/)
  assert.match(validateSettings({ inventado: 1 })[0], /desconocido/)
})

test('validación: los tramos solo se revisan con la comisión activa', () => {
  const rotos = commission({ byMethod: { credit: { tiers: [{ min: 100, pct: 4 }] }, debit: { tiers: [] } } })
  assert.ok(validateSettings({ cardCommission: rotos }).length > 0)
  // Apagada, unos tramos incompletos no deberían impedir guardar el resto.
  assert.deepEqual(validateSettings({ cardCommission: { ...rotos, enabled: false } }), [])
})

test('validación: un método sin tramos es válido y significa 0 % para ese método', () => {
  // Un negocio que solo acepta crédito no tiene por qué configurar débito.
  const soloCredito = commission({ byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] } } })
  assert.deepEqual(validateSettings({ cardCommission: soloCredito }), [])
})

test('validación: los tramos deben empezar en cero y subir', () => {
  const sinCero = commission({ byMethod: { credit: { tiers: [{ min: 5000, pct: 4 }] }, debit: { tiers: [{ min: 0, pct: 4 }] } } })
  assert.ok(validateSettings({ cardCommission: sinCero }).some((e) => /tramo inicial/i.test(e)))

  const desordenado = commission({
    byMethod: {
      credit: { tiers: [{ min: 0, pct: 4 }, { min: 0, pct: 3 }] },
      debit: { tiers: [{ min: 0, pct: 4 }] }
    }
  })
  assert.ok(validateSettings({ cardCommission: desordenado }).some((e) => /aumento/i.test(e)))

  const porcentajeAbsurdo = commission({
    byMethod: { credit: { tiers: [{ min: 0, pct: 150 }] }, debit: { tiers: [{ min: 0, pct: 4 }] } }
  })
  assert.ok(validateSettings({ cardCommission: porcentajeAbsurdo }).some((e) => /entre 0 y 100/.test(e)))
})

test('ajustes: el repositorio rechaza lo inválido y no guarda nada a medias', () => {
  const { settings } = createRepos(openDatabase(':memory:'))
  assert.throws(() => settings.set({ theme: 'dark', accent: 'azul' }), /#RRGGBB/)
  assert.equal(settings.get('theme'), 'system', 'un patch inválido no debe aplicar sus otras claves')

  settings.set({ theme: 'dark', accent: '#4ADE80' })
  assert.equal(settings.get('accent'), '#4ADE80')
})

test('ajustes: la comisión guardada es la que usa el cobro', () => {
  const repos = createRepos(openDatabase(':memory:'))
  const p = repos.products.create({ name: 'X', price_gross: 10000, stock: 10 })
  repos.settings.set({
    cardCommission: commission({ byMethod: { credit: { tiers: [{ min: 0, pct: 2.5 }] }, debit: { tiers: [{ min: 0, pct: 2.5 }] } } })
  })
  const venta = repos.sales.create({
    items: [{ productId: p.id, qty: 1, unitPrice: 10000 }],
    payments: [{ method: 'credit', amount: 10000 }]
  })
  assert.equal(venta.card_commission_rate, 2.5)
  assert.equal(venta.card_commission_amount, 250)
})

// ── Respaldo y restauración ──────────────────────────────────────────────────

test('inspección: reconoce una base del POS y rechaza cualquier otro archivo', () => {
  const dir = tmp()
  let db
  try {
    const file = join(dir, 'pos.sqlite')
    db = openDatabase(file)
    const repos = createRepos(db)
    const p = repos.products.create({ name: 'Café', price_gross: 5000, stock: 5 })
    repos.sales.create({ items: [{ productId: p.id, qty: 1, unitPrice: 5000 }], payments: [{ method: 'cash', amount: 5000 }] })

    const info = inspectDatabaseFile(file)
    assert.equal(info.version, migrations.at(-1).version)
    assert.equal(info.sales, 1)
    assert.equal(info.products, 1)

    const basura = join(dir, 'foto.png')
    writeFileSync(basura, 'no soy una base de datos')
    assert.throws(() => inspectDatabaseFile(basura), /no es una base de datos SQLite/)

    // Un SQLite válido pero de otra aplicación tampoco sirve.
    const ajena = join(dir, 'otra.sqlite')
    const otra = new Database(ajena)
    otra.exec('CREATE TABLE cosas (id INTEGER)')
    otra.close()
    assert.throws(() => inspectDatabaseFile(ajena), /no es una base de este POS/)

    assert.throws(() => inspectDatabaseFile(join(dir, 'no-existe.sqlite')), /No se pudo abrir/)
  } finally {
    // En Windows un archivo abierto no se puede borrar (EBUSY).
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('inspección: rechaza un respaldo de una versión más nueva', () => {
  const dir = tmp()
  try {
    const file = join(dir, 'futuro.sqlite')
    const db = openDatabase(file)
    db.prepare('UPDATE schema_version SET version = ?').run(migrations.at(-1).version + 5)
    db.close()
    assert.throws(() => inspectDatabaseFile(file), /versión más nueva/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restauración: reemplaza los datos y deja respaldo de lo anterior', () => {
  const dir = tmp()
  try {
    const backupDir = join(dir, 'backups')
    const dbPath = join(dir, 'pos.sqlite')

    // Base actual: un producto llamado «Actual».
    let db = openDatabase(dbPath, { backupDir })
    createRepos(db).products.create({ name: 'Actual', price_gross: 1000, stock: 1 })

    // Respaldo a restaurar: otra base, con dos productos distintos.
    const origen = join(dir, 'respaldo.sqlite')
    const otra = openDatabase(origen)
    const reposOtra = createRepos(otra)
    reposOtra.products.create({ name: 'Restaurado A', price_gross: 2000, stock: 2 })
    reposOtra.products.create({ name: 'Restaurado B', price_gross: 3000, stock: 3 })
    otra.close()

    let cerrada = false
    const info = restoreDatabase({
      source: origen,
      dbPath,
      backupDir,
      db,
      closeDb: () => { db.close(); cerrada = true }
    })

    assert.ok(cerrada, 'debe cerrar la conexión antes de sobrescribir el archivo')
    assert.equal(info.products, 2)
    assert.match(info.safetyBackup, /pre-restore\.sqlite$/)

    // Los datos nuevos están en su sitio…
    const reabierta = openDatabase(dbPath, { backupDir })
    const nombres = createRepos(reabierta).products.search().map((p) => p.name).sort()
    assert.deepEqual(nombres, ['Restaurado A', 'Restaurado B'])
    reabierta.close()

    // …y lo anterior se puede recuperar del respaldo de seguridad.
    const previa = new Database(info.safetyBackup, { readonly: true })
    assert.equal(previa.prepare('SELECT name FROM products').get().name, 'Actual')
    previa.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('restauración: un archivo inválido no toca la base actual', () => {
  const dir = tmp()
  let db
  try {
    const backupDir = join(dir, 'backups')
    const dbPath = join(dir, 'pos.sqlite')
    db = openDatabase(dbPath, { backupDir })
    createRepos(db).products.create({ name: 'Intacto', price_gross: 1000, stock: 1 })

    const basura = join(dir, 'basura.sqlite')
    writeFileSync(basura, 'no soy una base')

    let cerrada = false
    assert.throws(
      () => restoreDatabase({ source: basura, dbPath, backupDir, db, closeDb: () => { cerrada = true } }),
      /no es una base de datos SQLite/
    )
    assert.equal(cerrada, false, 'no debe cerrar la base si el archivo no sirve')
    assert.equal(createRepos(db).products.search()[0].name, 'Intacto')
    assert.equal(listBackups(backupDir).length, 0, 'un intento fallido no debe dejar respaldos')
  } finally {
    db?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('logo: copia la imagen, rechaza formatos raros y conserva solo el vigente', () => {
  const dir = tmp()
  try {
    const png = join(dir, 'logo.png')
    writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'))

    const destino = importLogo(png, dir)
    assert.match(destino, /assets[\\/]logo-\d+\.png$/)
    assert.equal(readdirSync(join(dir, 'assets')).length, 1)

    // Cambiar el logo no debe dejar el anterior acumulado.
    const otro = join(dir, 'otro.png')
    copyFileSync(png, otro)
    const segundo = importLogo(otro, dir)
    const restantes = readdirSync(join(dir, 'assets'))
    assert.equal(restantes.length, 1)
    assert.equal(join(dir, 'assets', restantes[0]), segundo)

    const pdf = join(dir, 'documento.pdf')
    writeFileSync(pdf, 'x')
    assert.throws(() => importLogo(pdf, dir), /no admitido/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
