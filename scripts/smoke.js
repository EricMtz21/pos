// Prueba de humo de la UI: arranca la app empaquetada (out/) y maneja el inventario
// como lo haría una persona. Uso: npm run smoke
import electron from 'electron'
import { bootApp, setup, fail } from './smoke-lib.js'

await bootApp(import.meta.dirname)

electron.app
  .whenReady()
  .then(async () => {
    const { run, check, waitFor, shot, key, lastToast, finish } = await setup({ prefix: 'smoke' })

    // La app abre en Ventas; esta prueba cubre el inventario.
    await key('i', { ctrlKey: true })
    await waitFor(`document.querySelector('#inv-rows')`, 'Ctrl+I lleva a Inventario')

    // ── Shell ────────────────────────────────────────────
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

    // ── Alta de producto (con el cálculo de IVA en vivo) ──
    const openForm = async () => {
      await run(`document.querySelector('#inv-new').click()`)
      await waitFor(`document.querySelector('#product-form')`, 'el formulario de producto abre')
    }
    const fillForm = (fields) =>
      run(`(() => {
        const f = document.querySelector('#product-form')
        ${Object.entries(fields).map(([k, v]) => `f.${k}.value = ${JSON.stringify(v)}`).join('; ')}
        f.dispatchEvent(new Event('input', { bubbles: true }))
        return document.querySelector('#derived').textContent
      })()`)
    const submitForm = () => run(`document.querySelector('[form="product-form"]').click()`)

    await openForm()
    const derived = await fillForm({
      code: '7501999000001',
      name: 'Café molido 500g',
      price_gross: '145.50',
      cost: '92'
    })
    // $145.50 con IVA → $125.43 sin IVA; margen sobre el neto: (125.43 - 92) / 125.43 = 26.7 %
    check(/125\.43/.test(derived), `el precio sin IVA salió mal: "${derived}"`)
    check(/26\.7/.test(derived), `el margen salió mal: "${derived}"`)
    await shot('producto-form')

    await submitForm()
    await waitFor(`document.querySelectorAll('#inv-rows tr').length === 9`, 'la tabla suma el producto creado')
    check(/Café molido/.test(await lastToast()), 'no hubo confirmación de alta')
    check(!(await run(`Boolean(document.querySelector('dialog[open]'))`)), 'el modal no se cerró tras guardar')

    // Código duplicado: debe rechazarse con un mensaje legible, no un error de SQLite.
    await openForm()
    await fillForm({ code: '7501999000001', name: 'Duplicado', price_gross: '10' })
    await submitForm()
    await waitFor(`/Ya existe un producto con ese código/.test(
      [...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'aviso de código duplicado')
    check((await run(`document.querySelectorAll('#inv-rows tr').length`)) === 9, 'el duplicado se guardó de todos modos')

    // ── Búsqueda ─────────────────────────────────────────
    const search = (text) =>
      run(`(() => { const s = document.querySelector('#inv-search'); s.value = ${JSON.stringify(text)}
             s.dispatchEvent(new Event('input', { bubbles: true })) })()`)
    await search('café')
    await waitFor(`document.querySelectorAll('#inv-rows tr').length === 1`, 'la búsqueda filtra la tabla')
    await search('')
    await waitFor(`document.querySelectorAll('#inv-rows tr').length === 9`, 'limpiar la búsqueda restaura la tabla')

    // ── Ajuste de stock ──────────────────────────────────
    await run(`document.querySelector('#inv-rows tr [data-act="stock"]').click()`)
    await waitFor(`document.querySelector('#stock-form')`, 'el formulario de stock abre')
    await run(`(() => {
      const f = document.querySelector('#stock-form')
      f.type.value = 'in'; f.qty.value = '10'; f.reason.value = 'Compra a proveedor'
    })()`)
    await run(`document.querySelector('[form="stock-form"]').click()`)
    await waitFor(`/Stock de/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'confirmación del ajuste de stock')

    // ── Ayuda F1 ─────────────────────────────────────────
    await key('F1')
    await waitFor(`document.querySelector('.shortcut-list')`, 'F1 abre la ayuda')
    const help = await run(`({
      shortcuts: document.querySelectorAll('.shortcut-row').length,
      text: document.querySelector('dialog[open] .modal-body')?.innerText ?? ''
    })`)
    check(help.shortcuts >= 7, `la ayuda lista ${help.shortcuts} atajos, se esperaban al menos 7`)
    check(/Nuevo producto/.test(help.text), 'la ayuda no incluye los atajos de la vista activa')
    await shot('ayuda')

    await run(`document.querySelector('dialog[open]').close()`)
    await waitFor(`!document.querySelector('dialog[open]')`, 'la ayuda se cierra')

    // ── Tema claro ───────────────────────────────────────
    await key('d', { ctrlKey: true })
    await waitFor(`document.documentElement.dataset.theme === 'light'`, 'Ctrl+D cambia a modo claro')
    await shot('claro')

    finish('todos los chequeos pasaron')
  })
  .catch(fail)
