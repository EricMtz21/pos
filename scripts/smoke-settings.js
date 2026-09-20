// Prueba de humo de Ajustes: persistencia, editor de tramos con validación,
// respaldo y restauración real de la base. Uso: npm run smoke:settings
import electron from 'electron'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootApp, setup, fail } from './smoke-lib.js'

await bootApp(import.meta.dirname)

electron.app.whenReady().then(async () => {
  const { run, check, waitFor, shot, key, finish } = await setup({ prefix: 'set' })
  const dataDir = electron.app.getPath('userData')

  await key(',', { ctrlKey: true })
  await waitFor(`document.querySelector('#s-business')`, 'Ctrl+, abre Ajustes')

  // ── Datos del negocio: se guardan y sobreviven a recargar la vista ──
  await run(`(() => {
    const f = document.querySelector('#s-business')
    f.name.value = 'Abarrotes La Esquina'
    f.taxId.value = 'XAXX010101000'
    f.footer.value = 'Gracias por su preferencia'
    f.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor(`/Ajustes guardados/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'confirmación al guardar el negocio')

  const guardado = await run(`window.api.settings.get().then(s => s.business)`)
  check(guardado.name === 'Abarrotes La Esquina', `nombre guardado: ${guardado.name}`)
  check(guardado.taxId === 'XAXX010101000', `RFC guardado: ${guardado.taxId}`)

  // Los datos del negocio deben aparecer en el ticket.
  const ticket = await run(`(async () => {
    const p = await window.api.products.findByCode('7501000222222')
    const v = await window.api.sales.create({ items: [{ productId: p.id, qty: 1, unitPrice: 2800 }],
      payments: [{ method: 'cash', amount: 2800 }] })
    return (await window.api.ticket.preview(v.id)).join('\\n')
  })()`)
  check(/ABARROTES LA ESQUINA/.test(ticket), 'el ticket no toma el nombre del negocio')
  check(/XAXX010101000/.test(ticket), 'el ticket no toma el RFC')
  check(/Gracias por su preferencia/.test(ticket), 'el ticket no toma el mensaje al pie')

  // ── Vista previa del ticket: refleja lo recién guardado ──
  await waitFor(
    `document.querySelector('#s-ticket-preview')?.textContent.includes('ABARROTES LA ESQUINA')`,
    'la vista previa toma el nombre del negocio'
  )
  const previa58 = await run(`document.querySelector('#s-ticket-preview').textContent`)
  check(/TOTAL/.test(previa58) && /Gracias por su preferencia/.test(previa58), 'la vista previa no muestra el ticket completo')
  check(
    Math.max(...previa58.split('\n').map((l) => l.length)) <= 32,
    'la vista previa de 58 mm excede los 32 caracteres'
  )

  // Cambiar el ancho debe repintarla.
  await run(`(() => { const f = document.querySelector('#s-ticket'); f.width.value = '80'
    f.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(
    `document.querySelector('#s-ticket-preview').textContent.split(String.fromCharCode(10)).some((l) => l.length > 32)`,
    'la vista previa sigue el ancho de 80 mm'
  )
  const previa80 = await run(`document.querySelector('#s-ticket-preview').textContent`)
  check(
    Math.max(...previa80.split('\n').map((l) => l.length)) <= 48,
    'la vista previa de 80 mm excede los 48 caracteres'
  )

  // ── Umbral de stock: cambia lo que marca el inventario ──
  const stockBajoAntes = await run(`window.api.products.lowStock().then(p => p.length)`)
  await run(`(() => { const f = document.querySelector('#s-inventory')
    f.lowStockThreshold.value = '20'; f.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await waitFor(`window.api.settings.get().then(s => s.lowStockThreshold === 20)`, 'el umbral queda guardado')
  const stockBajoDespues = await run(`window.api.products.lowStock().then(p => p.length)`)
  check(stockBajoDespues > stockBajoAntes, `el umbral no tuvo efecto (${stockBajoAntes} → ${stockBajoDespues})`)

  // ── Apariencia: el acento se aplica en vivo y persiste ──
  await run(`document.querySelector('[data-accent="#14B8A6"]').click()`)
  await waitFor(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() === '#14B8A6'`, 'el acento se aplica en vivo')
  check((await run(`window.api.settings.get().then(s => s.accent)`)) === '#14B8A6', 'el acento no se guardó')

  // ── Editor de tramos ──
  // Arranca con los dos tramos por defecto (4 % y 3 % a partir del umbral).
  const tramosIniciales = await run(`document.querySelectorAll('.tier-block tbody tr').length`)
  check(tramosIniciales === 2, `el editor mostró ${tramosIniciales} tramos, se esperaban 2`)

  await run(`document.querySelector('#c-enabled').click()`) // activar comisiones
  await waitFor(`!document.querySelector('.commission-body').classList.contains('disabled')`, 'activar la comisión habilita el editor')

  await run(`document.querySelector('[data-add]').click()`)
  await waitFor(`document.querySelectorAll('.tier-block tbody tr').length === 3`, 'se agrega un tramo')
  await shot('comisiones')

  // Un porcentaje imposible debe avisar y NO guardarse.
  await run(`(() => {
    const i = document.querySelector('input[data-field="pct"][data-i="1"]')
    i.value = '150'; i.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(`document.querySelector('#c-errors').textContent.length > 0`, 'el editor avisa del porcentaje inválido')
  const errorTexto = await run(`document.querySelector('#c-errors').textContent`)
  check(/entre 0 y 100/.test(errorTexto), `mensaje de error: "${errorTexto}"`)

  // Y el proceso principal debe rechazarlo aunque la pantalla lo dejara pasar.
  const rechazo = await run(`window.api.settings.set({ cardCommission: { enabled: true, period: 'monthly',
    byMethod: { credit: { tiers: [{ min: 0, pct: 150 }] } } } }).then(() => 'ACEPTADO').catch(e => e.message)`)
  check(/entre 0 y 100/.test(rechazo), `el proceso principal aceptó un porcentaje inválido: ${rechazo}`)

  // Un tramo válido sí se guarda y lo usa el cobro.
  await run(`(() => {
    const min = document.querySelector('input[data-field="min"][data-i="1"]')
    const pct = document.querySelector('input[data-field="pct"][data-i="1"]')
    min.value = '1000'; min.dispatchEvent(new Event('input', { bubbles: true }))
    pct.value = '3'; pct.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector('#c-period').dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
  await waitFor(`document.querySelector('#c-errors').textContent === ''`, 'el editor queda sin errores')

  const config = await run(`window.api.settings.get().then(s => s.cardCommission)`)
  check(config.enabled === true, 'la comisión no quedó activada')
  check(config.byMethod.credit.tiers.length === 3, `tramos guardados: ${JSON.stringify(config.byMethod.credit.tiers)}`)
  check(config.byMethod.credit.tiers[1].min === 100000, `el segundo tramo arranca en ${config.byMethod.credit.tiers[1].min} centavos`)
  check(config.byMethod.credit.tiers[1].pct === 3, `porcentaje del segundo tramo: ${config.byMethod.credit.tiers[1].pct}`)
  check(
    JSON.stringify(config.byMethod.debit.tiers) === JSON.stringify(config.byMethod.credit.tiers),
    `con «misma tasa» el débito debe copiar los tramos del crédito: ${JSON.stringify(config.byMethod.debit.tiers)}`
  )

  // ── Respaldo ──
  await run(`document.querySelector('#s-backup').click()`)
  await waitFor(`/Respaldo creado/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'confirmación del respaldo')
  const respaldos = readdirSync(join(dataDir, 'backups')).filter((f) => f.endsWith('.sqlite'))
  check(respaldos.some((f) => /manual\.sqlite$/.test(f)), `respaldos en disco: ${respaldos.join(', ')}`)
  check(
    (await run(`document.querySelectorAll('#s-backups tr').length`)) === respaldos.length,
    'la tabla de respaldos no coincide con el disco'
  )
  await shot('ajustes')

  // ── Restauración: se rechaza un archivo que no es una base del POS ──
  const basura = join(dataDir, 'no-es-base.sqlite')
  writeFileSync(basura, 'esto no es una base de datos')
  const rechazoArchivo = await run(`window.api.backup.restore(${JSON.stringify(basura)})
    .then(() => 'ACEPTADO').catch(e => e.message)`)
  check(/no es una base de datos SQLite/.test(rechazoArchivo), `archivo inválido: ${rechazoArchivo}`)
  check(
    (await run(`window.api.settings.get().then(s => s.business.name)`)) === 'Abarrotes La Esquina',
    'una restauración fallida alteró los datos actuales'
  )

  // ── Restauración real: se restaura el respaldo previo a todos estos cambios ──
  const respaldoPrevio = join(dataDir, 'backups', respaldos.sort()[0])
  const resultado = await run(`window.api.backup.inspect ? 'ok' : 'falta'`)
  check(resultado === 'ok', 'falta la API de inspección')

  const restaurado = await run(`window.api.backup.restore(${JSON.stringify(respaldoPrevio)})
    .then(r => JSON.stringify(r)).catch(e => 'ERROR: ' + e.message)`)
  check(!/^ERROR/.test(restaurado), `la restauración falló: ${restaurado}`)
  check(/safetyBackup/.test(restaurado), `la restauración no dejó respaldo de seguridad: ${restaurado}`)

  const nuevos = readdirSync(join(dataDir, 'backups'))
  check(nuevos.some((f) => /pre-restore\.sqlite$/.test(f)), `no hay respaldo pre-restore: ${nuevos.join(', ')}`)
  check(existsSync(join(dataDir, 'pos.sqlite')), 'la base desapareció tras restaurar')

  finish('ajustes, editor de comisiones, respaldo y restauración')
}).catch(fail)
