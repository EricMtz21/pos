import { icon, hydrateIcons } from '../icons.js'
import { register, kbd } from '../shortcuts/index.js'
import { toast } from '../components/toast.js'
import { confirmModal } from '../components/modal.js'
import { openPayment } from './payment.js'
import { showTicket } from './ticket-modal.js'
import { calculateTotals } from '../../shared/business/totals.js'
import { formatMoney } from '../../shared/money.js'

const escape = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

export async function renderSales(container) {
  /** @type {{productId, name, unit, qty, unitPrice, taxRate, stock}[]} */
  let cart = []
  let selected = 0 // índice de la línea seleccionada del carrito
  let results = [] // resultados de la búsqueda en vivo
  let highlighted = 0 // índice resaltado dentro de los resultados

  container.innerHTML = `
    <div class="sale">
      <div class="sale-main">
        <div class="scanner search">
          ${icon('scan-barcode')}
          <input id="scan" type="text" autocomplete="off" spellcheck="false"
                 placeholder="Escanea un código o escribe para buscar…" aria-label="Escáner y búsqueda" />
          <div id="results" class="results" role="listbox"></div>
        </div>
        <div class="cart-wrap">
          <table>
            <thead>
              <tr><th>Producto</th><th class="num">Precio</th><th class="num">Cantidad</th><th class="num">Importe</th><th></th></tr>
            </thead>
            <tbody id="cart"></tbody>
          </table>
        </div>
      </div>

      <aside class="totals">
        <div class="totals-row"><span>Artículos</span><span id="t-count">0</span></div>
        <div class="totals-row"><span>Subtotal</span><span id="t-subtotal">${formatMoney(0)}</span></div>
        <div class="totals-row"><span>IVA incluido</span><span id="t-tax">${formatMoney(0)}</span></div>
        <div class="totals-row grand"><span>Total</span><strong id="t-total">${formatMoney(0)}</strong></div>
        <button class="btn primary" id="btn-pay" disabled>Cobrar ${kbd('F12')}</button>
        <button class="btn ghost" id="btn-clear" disabled>Cancelar venta ${kbd('F8')}</button>
        <button class="btn ghost" id="btn-reprint">Último ticket ${kbd('Ctrl+P')}</button>
      </aside>
    </div>`
  hydrateIcons(container)

  const scan = container.querySelector('#scan')
  const resultsBox = container.querySelector('#results')
  const cartBody = container.querySelector('#cart')
  const payBtn = container.querySelector('#btn-pay')
  const clearBtn = container.querySelector('#btn-clear')

  // ── Carrito ────────────────────────────────────────────────────────────────

  const totals = () => calculateTotals(cart.map((l) => ({ ...l })))

  function renderCart() {
    if (cart.length === 0) {
      cartBody.innerHTML = `<tr><td colspan="5" class="muted" style="padding:44px;text-align:center">
        Escanea un producto o escríbelo arriba para empezar.</td></tr>`
    } else {
      selected = Math.min(selected, cart.length - 1)
      cartBody.innerHTML = cart
        .map((line, i) => {
          const excede = line.qty > line.stock
          return `<tr class="cart-row" data-i="${i}" aria-selected="${i === selected}">
            <td>
              ${escape(line.name)}
              ${excede ? `<div class="stock-warn">Supera el stock (${line.stock} ${escape(line.unit)})</div>` : ''}
            </td>
            <td class="num muted">${formatMoney(line.unitPrice)}</td>
            <td class="num">
              <span class="qty-control">
                <button class="btn ghost" data-act="dec" aria-label="Quitar uno">${icon('minus')}</button>
                <span class="qty">${line.qty}</span>
                <button class="btn ghost" data-act="inc" aria-label="Agregar uno">${icon('plus')}</button>
              </span>
            </td>
            <td class="num"><strong>${formatMoney(Math.round(line.qty * line.unitPrice))}</strong></td>
            <td><div class="row-actions">
              <button class="btn ghost icon-only danger" data-act="del" aria-label="Quitar del carrito">${icon('trash-2')}</button>
            </div></td>
          </tr>`
        })
        .join('')
      hydrateIcons(cartBody)
    }

    const t = totals()
    container.querySelector('#t-count').textContent = cart.reduce((s, l) => s + l.qty, 0)
    container.querySelector('#t-subtotal').textContent = formatMoney(t.subtotal)
    container.querySelector('#t-tax').textContent = formatMoney(t.tax)
    container.querySelector('#t-total').textContent = formatMoney(t.total)
    payBtn.disabled = cart.length === 0
    clearBtn.disabled = cart.length === 0
  }

  function addProduct(product, qty = 1) {
    const existing = cart.find((l) => l.productId === product.id)
    if (existing) existing.qty += qty
    else
      cart.push({
        productId: product.id,
        name: product.name,
        unit: product.unit,
        qty,
        unitPrice: product.price_gross,
        taxRate: product.tax_rate,
        stock: product.stock
      })
    selected = cart.findIndex((l) => l.productId === product.id)
    closeResults()
    scan.value = ''
    renderCart()
  }

  const changeQty = (i, delta) => {
    const line = cart[i]
    if (!line) return
    if (line.qty + delta <= 0) return removeLine(i)
    line.qty = Number((line.qty + delta).toFixed(3))
    selected = i
    renderCart()
  }

  const removeLine = (i) => {
    if (!cart[i]) return
    cart.splice(i, 1)
    selected = Math.max(0, Math.min(selected, cart.length - 1))
    renderCart()
  }

  async function clearSale() {
    if (cart.length === 0) return
    const ok = await confirmModal({
      title: 'Cancelar venta',
      message: `Se quitarán los ${cart.length} productos del carrito. Esta venta no se guarda.`,
      confirmLabel: 'Cancelar venta',
      danger: true
    })
    if (!ok) return
    cart = []
    renderCart()
    scan.focus()
  }

  // ── Búsqueda en vivo ───────────────────────────────────────────────────────

  function closeResults() {
    results = []
    highlighted = 0
    resultsBox.innerHTML = ''
  }

  function renderResults() {
    resultsBox.innerHTML = results
      .map(
        (p, i) => `<button class="result" type="button" role="option" data-i="${i}" aria-selected="${i === highlighted}">
          <span class="name">${escape(p.name)}</span>
          <span class="muted">${p.stock} ${escape(p.unit)}</span>
          <span class="price">${formatMoney(p.price_gross)}</span>
        </button>`
      )
      .join('')
  }

  let searchTimer
  scan.addEventListener('input', () => {
    clearTimeout(searchTimer)
    const text = scan.value.trim()
    if (text.length < 2) return closeResults()
    searchTimer = setTimeout(async () => {
      results = await window.api.products.search({ text, limit: 8 })
      highlighted = 0
      renderResults()
    }, 120)
  })

  resultsBox.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]')
    if (btn) addProduct(results[Number(btn.dataset.i)])
  })

  /**
   * Enter resuelve la entrada. El lector de barras teclea el código y manda Enter, así que
   * primero se intenta la coincidencia exacta por código: eso es una venta con un solo gesto.
   */
  async function submitScan() {
    const text = scan.value.trim()
    if (!text) return

    // Si hay un resultado resaltado y el usuario navegó con flechas, gana ese.
    if (results.length > 0 && highlighted > 0) return addProduct(results[highlighted])

    const byCode = await window.api.products.findByCode(text)
    if (byCode) return addProduct(byCode)
    if (results.length > 0) return addProduct(results[highlighted])

    const matches = await window.api.products.search({ text, limit: 8 })
    if (matches.length === 1) return addProduct(matches[0])
    if (matches.length === 0) return toast(`Sin resultados para «${text}»`, 'error')
    results = matches
    highlighted = 0
    renderResults()
  }

  scan.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      return submitScan()
    }
    if (e.key === 'Escape' && (results.length || scan.value)) {
      e.preventDefault()
      scan.value = ''
      return closeResults()
    }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      if (results.length > 0) {
        highlighted = (highlighted + step + results.length) % results.length
        return renderResults()
      }
      // Sin resultados abiertos, las flechas mueven la selección del carrito.
      if (cart.length > 0) {
        selected = (selected + step + cart.length) % cart.length
        renderCart()
      }
      return
    }
    // Con la caja vacía, +/- y Supr actúan sobre la línea seleccionada del carrito.
    // (El manejador global los ignora mientras el foco está en un campo de texto.)
    if (scan.value === '' && cart.length > 0) {
      if (e.key === '+') return e.preventDefault(), changeQty(selected, 1)
      if (e.key === '-') return e.preventDefault(), changeQty(selected, -1)
      if (e.key === 'Delete') return e.preventDefault(), removeLine(selected)
    }
  })

  cartBody.addEventListener('click', (e) => {
    const row = e.target.closest('.cart-row')
    if (!row) return
    const i = Number(row.dataset.i)
    const act = e.target.closest('[data-act]')?.dataset.act
    if (act === 'inc') changeQty(i, 1)
    else if (act === 'dec') changeQty(i, -1)
    else if (act === 'del') removeLine(i)
    else {
      selected = i
      renderCart()
    }
  })

  // ── Cobro ──────────────────────────────────────────────────────────────────

  async function charge() {
    if (cart.length === 0) return
    const t = totals()
    const result = await openPayment({ total: t.total })
    if (!result) return

    try {
      const sale = await window.api.sales.create({
        items: cart.map((l) => ({ productId: l.productId, qty: l.qty, unitPrice: l.unitPrice })),
        payments: result.payments,
        cashReceived: result.cashReceived
      })
      cart = []
      renderCart()
      toast(`Venta ${sale.folio} · ${formatMoney(sale.total)}`)
      await showTicket(sale, { highlightChange: true })
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      scan.focus()
    }
  }

  async function reprint() {
    try {
      const sale = await window.api.sales.last()
      if (!sale) return toast('Todavía no hay ventas hoy', 'error')
      await showTicket(sale)
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      scan.focus()
    }
  }

  payBtn.addEventListener('click', charge)
  clearBtn.addEventListener('click', clearSale)
  container.querySelector('#btn-reprint').addEventListener('click', reprint)

  renderCart()
  scan.focus()

  const disposers = [
    register('F2', () => (scan.focus(), scan.select()), 'Nueva venta / enfocar escáner'),
    register('F3', () => (scan.focus(), scan.select()), 'Buscar producto'),
    register('F12', charge, 'Cobrar'),
    register('F8', clearSale, 'Cancelar venta actual'),
    register('Ctrl+P', reprint, 'Reimprimir último ticket'),
    register('+', () => changeQty(selected, 1), 'Aumentar cantidad del ítem seleccionado'),
    register('-', () => changeQty(selected, -1), 'Disminuir cantidad del ítem seleccionado'),
    register('Supr', () => removeLine(selected), 'Quitar ítem del carrito')
  ]
  return () => disposers.forEach((off) => off())
}
