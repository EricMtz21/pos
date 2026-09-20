// Prueba de humo del flujo de venta: escanear → carrito → cobrar → ticket, con el teclado.
// Uso: npm run smoke:sales
import electron from 'electron'
import { bootApp, setup, sleep, fail } from './smoke-lib.js'

await bootApp(import.meta.dirname)

electron.app.whenReady().then(async () => {
  const { run, check, waitFor, shot, key, finish } = await setup({ prefix: 'sale' })

  // Simula el lector de barras: teclea el código y manda Enter.
  const scanCode = async (code) => {
    await run(`(() => {
      const s = document.querySelector('#scan')
      s.focus(); s.value = ${JSON.stringify(code)}
      s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })()`)
    await sleep(400)
  }

  check((await run(`document.querySelector('#view-title').textContent`)) === 'Ventas', 'la app no abre en Ventas')
  check(await run(`document.activeElement.id === 'scan'`), 'el escáner no tiene el foco al abrir')

  // ── Escanear dos productos ──────────────────────────────
  await scanCode('7501055300020') // Refresco cola 600ml · $18.00
  await scanCode('7501000222222') // Arroz 1kg · $28.00 exento
  await scanCode('7501055300020') // repetido: debe sumar cantidad, no crear otra línea

  const cart = await run(`({
    rows: document.querySelectorAll('.cart-row').length,
    qtys: [...document.querySelectorAll('.cart-row .qty')].map(q => q.textContent),
    subtotal: document.querySelector('#t-subtotal').textContent,
    tax: document.querySelector('#t-tax').textContent,
    total: document.querySelector('#t-total').textContent,
    count: document.querySelector('#t-count').textContent
  })`)
  check(cart.rows === 2, `el carrito tiene ${cart.rows} líneas, se esperaban 2`)
  check(cart.qtys[0] === '2', `el producto repetido no acumuló cantidad: ${cart.qtys}`)
  check(/64\.00/.test(cart.total), `total incorrecto: ${cart.total}`)
  // $36 gravados al 16 % → $4.97 de IVA. El arroz está exento y no aporta.
  check(/4\.97/.test(cart.tax), `IVA incorrecto: ${cart.tax} (esperado $4.97)`)
  check(cart.count === '3', `contador de artículos: ${cart.count}`)
  await shot('carrito')

  // ── Búsqueda por nombre ─────────────────────────────────
  await run(`(() => { const s = document.querySelector('#scan'); s.focus(); s.value = 'galle'; s.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await waitFor(`document.querySelectorAll('.result').length > 0`, 'resultados de la búsqueda por nombre')
  await shot('busqueda')
  await run(`document.querySelector('#scan').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await waitFor(`document.querySelectorAll('.cart-row').length === 3`, 'Enter agrega el resultado buscado')

  // ── +/- y Supr sobre la línea seleccionada, con la caja vacía ──
  const beforeQty = await run(`document.querySelectorAll('.cart-row .qty')[2].textContent`)
  await run(`document.querySelector('#scan').dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }))`)
  await sleep(250)
  const afterQty = await run(`document.querySelectorAll('.cart-row .qty')[2].textContent`)
  check(Number(afterQty) === Number(beforeQty) + 1, `«+» no aumentó la cantidad (${beforeQty} → ${afterQty})`)

  await run(`document.querySelector('#scan').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))`)
  await sleep(300)
  check((await run(`document.querySelectorAll('.cart-row').length`)) === 2, 'Supr no quitó la línea del carrito')

  // Escribir en la caja NO debe disparar +/- ni Supr.
  await run(`(() => { const s = document.querySelector('#scan'); s.focus(); s.value = 'ab' })()`)
  await run(`document.querySelector('#scan').dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true }))`)
  await sleep(250)
  check((await run(`document.querySelectorAll('.cart-row .qty')[0].textContent`)) === '2', '«-» actuó mientras se escribía en la caja')
  await run(`(() => { const s = document.querySelector('#scan'); s.value = ''; s.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await sleep(200)

  // ── Cobro en efectivo (F12) ─────────────────────────────
  await key('F12')
  await waitFor(`document.querySelector('#pay-amount')`, 'F12 abre el cobro')
  const pay = await run(`({
    total: document.querySelector('#pay-amount').textContent,
    change: document.querySelector('.change-box strong').textContent,
    label: document.querySelector('.change-box span').textContent
  })`)
  check(/64\.00/.test(pay.total), `el cobro muestra ${pay.total}`)
  check(/0\.00/.test(pay.change) && pay.label === 'Cambio', `arranca en exacto: ${pay.label} ${pay.change}`)

  // Billete de $100 → cambio de $36
  await run(`document.querySelector('[data-cash="10000"]').click()`)
  await sleep(350)
  const change = await run(`document.querySelector('.change-box strong').textContent`)
  check(/36\.00/.test(change), `cambio incorrecto: ${change} (esperado $36.00)`)
  await shot('cobro')

  await run(`document.querySelector('#pay-confirm').click()`)
  await waitFor(`document.querySelector('#ticket-text')`, 'el ticket aparece tras cobrar')

  // ── Ticket ──────────────────────────────────────────────
  const ticket = await run(`({
    open: Boolean(document.querySelector('#ticket-text')),
    text: document.querySelector('#ticket-text')?.textContent ?? '',
    title: document.querySelector('dialog[open] h2')?.textContent ?? '',
    cartRows: document.querySelectorAll('.cart-row').length,
    total: document.querySelector('#t-total').textContent
  })`)
  check(ticket.open, 'no se mostró el ticket tras cobrar')
  check(/^Ticket V\d{8}-0001$/.test(ticket.title), `folio inesperado: ${ticket.title}`)
  check(/TOTAL\s+\$64\.00/.test(ticket.text), 'el ticket no cuadra con el total')
  check(/Cambio\s+\$36\.00/.test(ticket.text), 'el ticket no muestra el cambio')
  check(/IVA incluido\s+\$4\.97/.test(ticket.text), 'el ticket no desglosa el IVA')
  check(ticket.cartRows === 0, 'el carrito no se vació tras cobrar')
  check(/\$0\.00/.test(ticket.total), 'los totales no se reiniciaron')
  const maxLen = await run(`Math.max(...document.querySelector('#ticket-text').textContent.split('\\n').map(l => l.length))`)
  check(maxLen <= 32, `una línea del ticket mide ${maxLen} caracteres, el papel de 58mm admite 32`)
  await shot('ticket')

  await run(`document.querySelector('dialog[open]').close()`)
  await sleep(300)

  // ── El stock bajó por la venta ──────────────────────────
  const stock = await run(`window.api.products.findByCode('7501055300020').then(p => p.stock)`)
  check(stock === 34, `el stock del refresco quedó en ${stock}, se esperaba 34 (36 - 2)`)

  // ── Venta con tarjeta: se muestra la comisión ───────────
  await run(`window.api.settings.set({ cardCommission: { enabled: true, period: 'monthly', applyIvaOnCommission: false,
    byMethod: { credit: { tiers: [{ min: 0, pct: 4 }] }, debit: { tiers: [{ min: 0, pct: 4 }] } } } })`)
  await scanCode('7501000444444') // Detergente $55.00
  await key('F12')
  await waitFor(`document.querySelector('[data-method="credit"]')`, 'cobro de la venta con tarjeta')
  await run(`document.querySelector('[data-method="credit"]').click()`)
  await waitFor(`document.querySelector('.commission')`, 'desglose de comisión')
  const commission = await run(`document.querySelector('.commission')?.innerText ?? ''`)
  check(/Comisión 4 %/.test(commission), `no se muestra el % de comisión: "${commission}"`)
  check(/\$2\.20/.test(commission), `comisión incorrecta: "${commission}" (4 % de $55 = $2.20)`)
  check(/\$52\.80/.test(commission), `neto incorrecto: "${commission}" (esperado $52.80)`)
  await shot('comision')

  await run(`document.querySelector('#pay-confirm').click()`)
  await waitFor(`document.querySelector('#ticket-text')`, 'ticket de la venta con tarjeta')
  const cardTicket = await run(`document.querySelector('#ticket-text')?.textContent ?? ''`)
  check(/Tarjeta crédito\s+\$55\.00/.test(cardTicket), 'el ticket no refleja el cobro con tarjeta')
  check(!/[Cc]omisi/.test(cardTicket), 'el ticket le muestra la comisión al cliente')
  check(!/52\.80/.test(cardTicket), 'el ticket revela el neto del negocio')

  const saved = await run(`window.api.sales.last().then(s => ({ rate: s.card_commission_rate, amount: s.card_commission_amount, net: s.net_total, total: s.total }))`)
  check(saved.rate === 4 && saved.amount === 220, `comisión guardada: ${JSON.stringify(saved)}`)
  check(saved.total === 5500 && saved.net === 5280, `neto guardado: ${JSON.stringify(saved)}`)

  await run(`document.querySelector('dialog[open]').close()`)
  await sleep(300)

  // ── F8 cancela la venta en curso ────────────────────────
  await scanCode('7501000222222')
  await key('F8')
  await waitFor(`document.querySelector('dialog[open] [data-close="ok"]')`, 'F8 pide confirmación')
  await run(`document.querySelector('dialog[open] [data-close="ok"]').click()`)
  await waitFor(`document.querySelectorAll('.cart-row').length === 0`, 'F8 vacía el carrito')

  finish('flujo de venta completo')
}).catch(fail)
