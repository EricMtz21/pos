// Prueba de humo de reportes y corte de caja: vende, revisa los totales en pantalla,
// hace el arqueo y exporta un Excel que se vuelve a leer para comprobarlo.
// Uso: npm run smoke:reports
import electron from 'electron'
import ExcelJS from 'exceljs'
import { existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootApp, setup, fail } from './smoke-lib.js'

await bootApp(import.meta.dirname)

electron.app.whenReady().then(async () => {
  const { run, check, waitFor, shot, key, finish } = await setup({ prefix: 'rep' })
  const dataDir = electron.app.getPath('userData')

  // ── Ventas de prueba, vía IPC para llegar rápido a los reportes ──
  await run(`window.api.settings.set({ cardCommission: { enabled: true, period: 'monthly',
    applyIvaOnCommission: false,
    byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] }, debit: { tiers: [{ min: 0, pct: 2 }] } } } })`)

  const ventas = await run(`(async () => {
    const [refresco, arroz] = await Promise.all([
      window.api.products.findByCode('7501055300020'),  // $18.00 con IVA 16 %
      window.api.products.findByCode('7501000222222')   // $28.00 exento
    ])
    // 1) efectivo, 2) crédito, 3) mixto efectivo + débito
    await window.api.sales.create({ items: [{ productId: refresco.id, qty: 2, unitPrice: 1800 }],
      payments: [{ method: 'cash', amount: 3600 }], cashReceived: 5000 })
    await window.api.sales.create({ items: [{ productId: arroz.id, qty: 1, unitPrice: 2800 }],
      payments: [{ method: 'credit', amount: 2800 }] })
    await window.api.sales.create({ items: [{ productId: refresco.id, qty: 5, unitPrice: 1800 }],
      payments: [{ method: 'cash', amount: 4000 }, { method: 'debit', amount: 5000 }], cashReceived: 4000 })
    return (await window.api.reports.get({ from: new Date().toLocaleDateString('en-CA'), to: new Date().toLocaleDateString('en-CA') })).summary
  })()`)

  // Bruto: 3600 + 2800 + 9000 = 15400. Comisión: 4 % de 2800 (112) + 2 % de 5000 (100) = 212.
  check(ventas.sales === 3, `se registraron ${ventas.sales} ventas, se esperaban 3`)
  check(ventas.gross === 15400, `bruto ${ventas.gross}, esperado 15400`)
  check(ventas.commission === 212, `comisión ${ventas.commission}, esperada 212`)
  check(ventas.net === 15188, `neto ${ventas.net}, esperado 15188`)

  // ── Pantalla de reportes ──
  await key('r', { ctrlKey: true })
  await waitFor(`document.querySelector('#r-cards .report-card')`, 'Ctrl+R abre Reportes')

  const tarjetas = await run(`[...document.querySelectorAll('.report-card')].map(c =>
    c.querySelector('.label').textContent + ': ' + c.querySelector('strong').textContent)`)
  check(tarjetas.some((t) => /Venta bruta: \$154\.00/.test(t)), `tarjeta de bruto: ${tarjetas}`)
  check(tarjetas.some((t) => /Comisiones: -\$2\.12/.test(t)), `tarjeta de comisiones: ${tarjetas}`)
  check(tarjetas.some((t) => /Venta neta: \$151\.88/.test(t)), `tarjeta de neto: ${tarjetas}`)

  // Desglose por método: el mixto debe repartirse, y cada tarjeta llevar SU tasa.
  const metodos = await run(`[...document.querySelectorAll('#r-methods tr')].map(r =>
    [...r.cells].map(c => c.textContent.trim()))`)
  const porMetodo = Object.fromEntries(metodos.map((r) => [r[0], r]))
  check(/\$76\.00/.test(porMetodo['Efectivo']?.[1]), `efectivo: ${JSON.stringify(porMetodo['Efectivo'])} (3600+4000)`)
  check(/-\$1\.12/.test(porMetodo['Tarjeta crédito']?.[2]), `comisión de crédito al 4 %: ${JSON.stringify(porMetodo['Tarjeta crédito'])}`)
  check(/-\$1\.00/.test(porMetodo['Tarjeta débito']?.[2]), `comisión de débito al 2 %: ${JSON.stringify(porMetodo['Tarjeta débito'])}`)
  check(porMetodo['Efectivo']?.[2] === '—', 'el efectivo no debe mostrar comisión')
  await shot('reportes')

  // ── Un rango sin ventas no debe romper la pantalla ──
  // Hay que mover las dos fechas: dejar «hasta» en hoy seguiría incluyendo las ventas.
  const setDate = (id, value) =>
    run(`(() => { const f = document.querySelector('${id}'); f.value = '${value}'
      f.dispatchEvent(new Event('change', { bubbles: true })) })()`)
  await setDate('#r-from', '2020-01-01')
  await setDate('#r-to', '2020-01-02')
  await waitFor(`/Sin ventas en el periodo/.test(document.querySelector('#r-days').textContent)`, 'rango vacío muestra aviso')
  const vacias = await run(`[...document.querySelectorAll('.report-card strong')].map(s => s.textContent)`)
  check(vacias[0] === '0' && /\$0\.00/.test(vacias[1]), `las tarjetas no se reiniciaron: ${vacias.join(' | ')}`)

  // Rango invertido: debe corregirse solo, no quedarse vacío.
  await setDate('#r-from', '2030-01-01')
  const corregido = await run(`({ from: document.querySelector('#r-from').value, to: document.querySelector('#r-to').value })`)
  check(corregido.from <= corregido.to, `el rango quedó invertido: ${JSON.stringify(corregido)}`)

  await run(`document.querySelector('[data-preset="hoy"]').click()`)
  await waitFor(`document.querySelectorAll('#r-sales tr[data-sale]').length === 3`, 'el preset Hoy restaura las ventas')

  // ── Corte de caja (Ctrl+B) ──
  const backupsAntes = existsSync(join(dataDir, 'backups')) ? readdirSync(join(dataDir, 'backups')).length : 0

  await key('b', { ctrlKey: true })
  await waitFor(`document.querySelector('#cut-form')`, 'Ctrl+B abre el corte de caja')

  // Efectivo del día: 3600 + 4000 = 7600. Con fondo de $500 → esperado $576.00
  const esperadoInicial = await run(`document.querySelector('#cut-expected').textContent`)
  check(/\$76\.00/.test(esperadoInicial), `esperado sin fondo: ${esperadoInicial}`)

  await run(`(() => {
    const f = document.querySelector('#cut-form')
    f.opening.value = '500'; f.counted.value = '570'; f.notes.value = 'faltó un billete'
    f.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const arqueo = await run(`({
    expected: document.querySelector('#cut-expected').textContent,
    label: document.querySelector('#cut-diff-label').textContent,
    diff: document.querySelector('#cut-diff').textContent
  })`)
  check(/\$576\.00/.test(arqueo.expected), `esperado con fondo: ${arqueo.expected}`)
  check(arqueo.label === 'Faltante', `debería marcar faltante, dice «${arqueo.label}»`)
  check(/\$6\.00/.test(arqueo.diff), `faltante incorrecto: ${arqueo.diff}`)
  await shot('corte')

  await run(`document.querySelector('[form="cut-form"]').click()`)
  // Se espera el aviso de la pantalla, que es la señal real de que el corte se guardó.
  // «hay al menos una fila» no servía: la tabla vacía ya trae su fila de «sin cortes».
  // Margen amplio: registrar el corte dispara un respaldo de la base (VACUUM INTO), y
  // escribir en una carpeta sincronizada con OneDrive puede tardar varios segundos.
  await waitFor(
    `/Corte registrado/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`,
    'el corte queda registrado',
    15000
  )
  await waitFor(`!document.querySelector('#cut-form')`, 'el modal del corte se cierra')

  const corte = await run(`window.api.cashCuts.list(1).then(c => c[0])`)
  check(corte.expected_cash === 57600, `esperado guardado: ${corte.expected_cash}`)
  check(corte.counted_cash === 57000, `contado guardado: ${corte.counted_cash}`)
  check(corte.difference === -600, `diferencia guardada: ${corte.difference}`)

  // §6: el corte debe dejar un respaldo automático de la base. Ocurre justo después de
  // responder, no antes, así que se espera a que el archivo aparezca.
  let backups = []
  for (let esperado = 0; esperado < 15000; esperado += 100) {
    backups = readdirSync(join(dataDir, 'backups'))
    if (backups.some((f) => /corte\.sqlite$/.test(f))) break
    await new Promise((r) => setTimeout(r, 100))
  }
  check(backups.length > backupsAntes, 'el corte no generó respaldo de la base')
  check(backups.some((f) => /corte\.sqlite$/.test(f)), `respaldos: ${backups.join(', ')}`)

  // ── Exportar a Excel y volver a leerlo ──
  const xlsx = join(dataDir, 'reporte-prueba.xlsx')
  rmSync(xlsx, { force: true })
  electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: xlsx })

  // Se pulsa el botón, no la API: así se prueba también que la pantalla confirme.
  await run(`document.querySelector('#r-export').click()`)
  await waitFor(`/Reporte guardado/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'confirmación de exportación')
  check(existsSync(xlsx), 'no se escribió el archivo de Excel')

  const book = new ExcelJS.Workbook()
  await book.xlsx.readFile(xlsx)
  check(
    book.worksheets.map((w) => w.name).join(',') === 'Resumen,Ventas por día,Métodos de pago,Productos,Ventas,Cortes de caja',
    `hojas del libro: ${book.worksheets.map((w) => w.name).join(', ')}`
  )

  const resumen = Object.fromEntries(
    book.getWorksheet('Resumen').getRows(1, 20).map((r) => [r.getCell(1).value, r.getCell(2).value])
  )
  check(resumen['Venta bruta'] === 154, `Excel bruto: ${resumen['Venta bruta']} (esperado 154 pesos)`)
  check(resumen['Comisiones de tarjeta'] === 2.12, `Excel comisión: ${resumen['Comisiones de tarjeta']}`)
  check(resumen['Venta neta'] === 151.88, `Excel neto: ${resumen['Venta neta']}`)

  const cortes = book.getWorksheet('Cortes de caja')
  check(cortes.getRow(2).getCell(6).value === -6, `Excel diferencia del corte: ${cortes.getRow(2).getCell(6).value}`)
  check(cortes.getColumn(6).numFmt === '"$"#,##0.00', 'la columna de dinero no lleva formato de moneda')

  const ventasHoja = book.getWorksheet('Ventas')
  check(ventasHoja.rowCount === 4, `la hoja de ventas tiene ${ventasHoja.rowCount} filas (1 encabezado + 3 ventas)`)

  finish('reportes, corte de caja y exportación a Excel')
}).catch(fail)
