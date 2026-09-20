// Prueba de humo de la UI: arranca la app empaquetada (out/), maneja el inventario como
// lo haría una persona y guarda capturas. Uso: npm run smoke
// Nota: exige `unset ELECTRON_RUN_AS_NODE`, o Electron arranca como Node puro.
import electron from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { app, BrowserWindow } = electron
const outDir = process.env.SMOKE_OUT ?? process.cwd()
await import(pathToFileURL(join(import.meta.dirname, '../out/main/index.cjs')).href)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const problems = []
const check = (cond, msg) => !cond && problems.push(msg)

app.whenReady().then(async () => {
  await sleep(2500)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('No se abrió ninguna ventana')
  const run = (js) => win.webContents.executeJavaScript(js)
  const shot = async (name) => writeFileSync(join(outDir, `smoke-${name}.png`), (await win.webContents.capturePage()).toPNG())

  // ── Shell ──────────────────────────────────────────────
  const shell = await run(`({
    nav: [...document.querySelectorAll('.nav-item[data-view]')].map(b => b.querySelector('.nav-label').textContent),
    kbds: document.querySelectorAll('.nav-item kbd').length,
    glass: getComputedStyle(document.querySelector('.sidebar')).backdropFilter,
    emojis: /\\p{Extended_Pictographic}/u.test(document.body.innerText),
    rows: document.querySelectorAll('#inv-rows tr').length,
    lowBadges: document.querySelectorAll('#inv-rows .badge.warn').length
  })`)
  check(shell.nav.length === 4, 'sidebar incompleto')
  check(shell.kbds > 0, 'faltan badges de atajos')
  check(shell.glass.includes('blur'), 'sidebar sin glassmorphism')
  check(!shell.emojis, 'hay emojis en la UI')
  check(shell.rows === 8, `el inventario mostró ${shell.rows} filas, se esperaban 8 del seed`)
  check(shell.lowBadges === 2, `alertas de stock bajo: ${shell.lowBadges}, se esperaban 2`)
  await shot('inventario')

  // ── Alta de producto (incluye el cálculo de IVA en vivo) ──
  await run(`document.querySelector('#inv-new').click()`)
  await sleep(350)
  const derived = await run(`(() => {
    const f = document.querySelector('#product-form')
    f.code.value = '7501999000001'
    f.name.value = 'Café molido 500g'
    f.price_gross.value = '145.50'
    f.cost.value = '92'
    f.dispatchEvent(new Event('input', { bubbles: true }))
    return document.querySelector('#derived').textContent
  })()`)
  // $145.50 con IVA → $125.43 sin IVA; margen sobre el neto: (125.43 - 92) / 125.43 = 26.7 %
  check(/125\.43/.test(derived), `el precio sin IVA salió mal: "${derived}"`)
  check(/26\.7/.test(derived), `el margen salió mal: "${derived}"`)
  await shot('producto-form')

  await run(`document.querySelector('[form="product-form"]').click()`)
  await sleep(600)
  const afterCreate = await run(`({
    rows: document.querySelectorAll('#inv-rows tr').length,
    toast: document.querySelector('.toast')?.textContent ?? '',
    dialog: Boolean(document.querySelector('dialog[open]'))
  })`)
  check(afterCreate.rows === 9, `tras crear hay ${afterCreate.rows} filas, se esperaban 9`)
  check(/Café molido/.test(afterCreate.toast), `sin confirmación de alta: "${afterCreate.toast}"`)
  check(!afterCreate.dialog, 'el modal no se cerró tras guardar')

  // Código duplicado: debe rechazarse con un mensaje legible, no un error de SQLite.
  await run(`document.querySelector('#inv-new').click()`)
  await sleep(300)
  await run(`(() => {
    const f = document.querySelector('#product-form')
    f.code.value = '7501999000001'; f.name.value = 'Duplicado'; f.price_gross.value = '10'
  })()`)
  await run(`document.querySelector('[form="product-form"]').click()`)
  await sleep(500)
  const dup = await run(`[...document.querySelectorAll('.toast')].at(-1)?.textContent ?? ''`)
  check(/Ya existe un producto con ese código/.test(dup), `código duplicado sin mensaje claro: "${dup}"`)

  // ── Búsqueda ───────────────────────────────────────────
  await run(`(() => { const s = document.querySelector('#inv-search'); s.value = 'café'; s.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(400)
  check((await run(`document.querySelectorAll('#inv-rows tr').length`)) === 1, 'la búsqueda no filtró')
  await run(`(() => { const s = document.querySelector('#inv-search'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(300)

  // ── Ajuste de stock ────────────────────────────────────
  await run(`document.querySelector('#inv-rows tr [data-act="stock"]').click()`)
  await sleep(450)
  await run(`(() => {
    const f = document.querySelector('#stock-form')
    f.type.value = 'in'; f.qty.value = '10'; f.reason.value = 'Compra a proveedor'
  })()`)
  await run(`document.querySelector('[form="stock-form"]').click()`)
  await sleep(500)
  const stockToast = await run(`[...document.querySelectorAll('.toast')].at(-1)?.textContent ?? ''`)
  check(/Stock de/.test(stockToast), `el ajuste de stock no confirmó: "${stockToast}"`)

  // ── Ayuda F1 ───────────────────────────────────────────
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true }))`)
  await sleep(400)
  const help = await run(`({
    open: Boolean(document.querySelector('dialog[open]')),
    shortcuts: document.querySelectorAll('.shortcut-row').length,
    text: document.querySelector('dialog[open] .modal-body')?.innerText ?? ''
  })`)
  check(help.open, 'F1 no abrió la ayuda')
  check(help.shortcuts >= 7, `la ayuda lista ${help.shortcuts} atajos, se esperaban al menos 7`)
  check(/Nuevo producto/.test(help.text), 'la ayuda no incluye los atajos de la vista activa')
  await shot('ayuda')

  await run(`document.querySelector('dialog[open]').close()`)
  await sleep(250)

  // ── Tema claro ─────────────────────────────────────────
  await run(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))`)
  await sleep(500)
  check((await run(`document.documentElement.dataset.theme`)) === 'light', 'Ctrl+D no cambió a modo claro')
  await shot('claro')

  console.log(problems.length ? `FALLO:\n- ${problems.join('\n- ')}` : 'OK · todos los chequeos pasaron')
  app.exit(problems.length ? 1 : 0)
})
