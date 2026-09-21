import { openModal } from '../components/modal.js'
import { icon } from '../icons.js'
import { formatMoney, parseMoney } from '../../shared/money.js'

const METHODS = [
  { id: 'cash', label: 'Efectivo', icon: 'banknote', key: '1' },
  { id: 'debit', label: 'Débito', icon: 'credit-card', key: '2' },
  { id: 'credit', label: 'Crédito', icon: 'credit-card', key: '3' },
  { id: 'transfer', label: 'Transferencia', icon: 'landmark', key: '4' },
  { id: 'mixed', label: 'Mixto', icon: 'wallet', key: '5' }
]

// Billetes con los que suele pagar la gente; se filtran a los que cubren el total.
const BILLS = [5000, 10000, 20000, 50000, 100000]

/**
 * Cobro de la venta. Devuelve { payments, cashReceived } listo para sales.create,
 * o null si se cancela.
 */
export function openPayment({ total, subtotal = total, discount = 0 }) {
  let method = 'cash'
  let received = total // efectivo recibido, en centavos
  const mixed = { cash: 0, debit: 0, credit: 0, transfer: 0 }

  return openModal({
    title: 'Cobrar',
    body: `
      ${discount > 0 ? `<div class="totals-row"><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
      <div class="totals-row"><span>Descuento</span><span>-${formatMoney(discount)}</span></div>` : ''}
      <div class="pay-total"><span>Total a cobrar</span><strong id="pay-amount">${formatMoney(total)}</strong></div>
      <div class="methods">
        ${METHODS.map(
          (m) => `<button class="method" type="button" data-method="${m.id}" aria-pressed="${m.id === 'cash'}">
            ${icon(m.icon)}<span>${m.label}</span><kbd>${m.key}</kbd>
          </button>`
        ).join('')}
      </div>
      <div id="pay-detail"></div>`,
    footer: `<button class="btn" type="button" data-close>Cancelar <kbd>Esc</kbd></button>
             <button class="btn primary" type="button" id="pay-confirm">Cobrar <kbd>Enter</kbd></button>`,
    onMount: ({ dialog, close }) => {
      const detail = dialog.querySelector('#pay-detail')
      const confirm = dialog.querySelector('#pay-confirm')

      // ── Lo que se guardará, según el método elegido ──
      const buildPayments = () =>
        method === 'mixed'
          ? Object.entries(mixed).filter(([, amount]) => amount > 0).map(([m, amount]) => ({ method: m, amount }))
          : [{ method, amount: total }]

      const mixedSum = () => Object.values(mixed).reduce((s, v) => s + v, 0)

      const isValid = () =>
        method === 'mixed' ? mixedSum() === total : method === 'cash' ? received >= total : true

      // ── Vistas por método ──
      function renderCash() {
        const change = received - total
        detail.innerHTML = `
          <label class="field">
            <span>Efectivo recibido</span>
            <input id="pay-received" inputmode="decimal" autocomplete="off" value="${(received / 100).toFixed(2)}" />
          </label>
          <div class="quick-cash">
            <button class="btn" type="button" data-cash="${total}">Exacto</button>
            ${BILLS.filter((b) => b > total).map((b) => `<button class="btn" type="button" data-cash="${b}">${formatMoney(b)}</button>`).join('')}
          </div>
          <div class="change-box ${change < 0 ? 'short' : ''}">
            <span>${change < 0 ? 'Falta' : 'Cambio'}</span><strong>${formatMoney(Math.abs(change))}</strong>
          </div>`

        const input = detail.querySelector('#pay-received')
        input.addEventListener('input', () => {
          const parsed = parseMoney(input.value)
          input.setAttribute('aria-invalid', parsed === null)
          received = parsed ?? 0
          const c = received - total
          const box = detail.querySelector('.change-box')
          box.classList.toggle('short', c < 0)
          box.querySelector('span').textContent = c < 0 ? 'Falta' : 'Cambio'
          box.querySelector('strong').textContent = formatMoney(Math.abs(c))
          confirm.disabled = !isValid()
        })
        detail.querySelectorAll('[data-cash]').forEach((btn) =>
          btn.addEventListener('click', () => {
            received = Number(btn.dataset.cash)
            renderCash()
            confirm.disabled = !isValid()
          })
        )
        input.focus()
        input.select()
      }

      async function renderCard() {
        detail.innerHTML = '<p class="hint">Calculando comisión…</p>'
        const preview = await window.api.sales.previewCommission({ method, amount: total })
        // La comisión es informativa: el cliente paga el total, el negocio recibe el neto (§14.1).
        detail.innerHTML = preview.enabled
          ? `<div class="commission">
               <div class="row"><span>Venta bruta</span><span>${formatMoney(total)}</span></div>
               <div class="row"><span>Comisión ${preview.rate} %</span><span>-${formatMoney(preview.amount)}</span></div>
               <div class="row net"><span>Neto a recibir</span><span>${formatMoney(total - preview.amount)}</span></div>
             </div>
             <p class="hint" style="margin-top:10px">El cliente paga ${formatMoney(total)}. La comisión solo afecta lo que recibe el negocio.</p>`
          : '<p class="hint">Las comisiones de tarjeta están desactivadas en Ajustes.</p>'
      }

      function renderMixed() {
        detail.innerHTML = `
          <div class="mixed-rows">
            ${METHODS.filter((m) => m.id !== 'mixed')
              .map(
                (m) => `<div class="mixed-row">
                  <span>${m.label}</span>
                  <input data-mixed="${m.id}" inputmode="decimal" autocomplete="off"
                         value="${mixed[m.id] ? (mixed[m.id] / 100).toFixed(2) : ''}" placeholder="0.00" />
                </div>`
              )
              .join('')}
          </div>
          <div class="remaining"><span>Falta por cubrir</span><strong id="pay-remaining"></strong></div>`

        const updateRemaining = () => {
          const left = total - mixedSum()
          const box = detail.querySelector('.remaining')
          box.classList.toggle('ok', left === 0)
          box.querySelector('span').textContent = left < 0 ? 'Sobra' : 'Falta por cubrir'
          detail.querySelector('#pay-remaining').textContent = formatMoney(Math.abs(left))
          confirm.disabled = !isValid()
        }

        detail.querySelectorAll('[data-mixed]').forEach((input) =>
          input.addEventListener('input', () => {
            const parsed = parseMoney(input.value)
            input.setAttribute('aria-invalid', parsed === null)
            mixed[input.dataset.mixed] = parsed ?? 0
            // Con pago mixto el efectivo recibido es exactamente la parte en efectivo: sin cambio.
            received = mixed.cash
            updateRemaining()
          })
        )
        updateRemaining()
        detail.querySelector('[data-mixed="cash"]').focus()
      }

      function selectMethod(id) {
        method = id
        dialog.querySelectorAll('[data-method]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.method === id))
        if (id === 'cash') renderCash()
        else if (id === 'mixed') renderMixed()
        else renderCard()
        confirm.disabled = !isValid()
      }

      dialog.querySelectorAll('[data-method]').forEach((btn) =>
        btn.addEventListener('click', () => selectMethod(btn.dataset.method))
      )

      // 1–5 eligen método; Enter cobra. El modal suspende los atajos globales,
      // así que estas teclas se manejan aquí.
      dialog.addEventListener('keydown', (e) => {
        const shortcut = METHODS.find((m) => m.key === e.key)
        if (shortcut && !['INPUT'].includes(e.target.tagName)) {
          e.preventDefault()
          return selectMethod(shortcut.id)
        }
        if (e.key === 'Enter') {
          e.preventDefault()
          if (isValid()) submit()
        }
      })

      const submit = () =>
        close({
          payments: buildPayments(),
          // Solo tiene sentido guardar el recibido cuando hubo efectivo de por medio.
          cashReceived: method === 'cash' ? received : method === 'mixed' && mixed.cash > 0 ? mixed.cash : null
        })

      confirm.addEventListener('click', () => isValid() && submit())
      selectMethod('cash')
    }
  })
}
