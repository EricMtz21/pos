import { openModal } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { formatMoney, parseMoney } from '../../shared/money.js'

const METHOD_LABELS = {
  cash: 'Efectivo',
  debit: 'Tarjeta débito',
  credit: 'Tarjeta crédito',
  transfer: 'Transferencia'
}

/**
 * Corte de caja: arqueo del efectivo del día.
 * El cajero captura el fondo inicial y lo que contó; el sistema calcula la diferencia.
 * Devuelve el corte registrado, o null si se canceló.
 */
export async function openCashCut(businessDate) {
  let opening = 0
  let counted = 0
  let preview = await window.api.cashCuts.preview({ businessDate, opening })

  const rowsHtml = () =>
    preview.byMethod.length
      ? preview.byMethod
          .map(
            (m) => `<div class="totals-row"><span>${METHOD_LABELS[m.method] ?? m.method} (${m.payments})</span>
                    <span>${formatMoney(m.total)}</span></div>`
          )
          .join('')
      : '<p class="hint">No hay ventas registradas en este día.</p>'

  return openModal({
    title: `Corte de caja · ${preview.businessDate}`,
    body: `
      <div class="cut-summary">
        ${rowsHtml()}
        <div class="totals-row grand"><span>Total vendido</span><strong>${formatMoney(preview.gross)}</strong></div>
        ${preview.commission > 0
          ? `<div class="totals-row"><span>Comisiones de tarjeta</span><span>-${formatMoney(preview.commission)}</span></div>
             <div class="totals-row"><span>Neto recibido</span><span>${formatMoney(preview.net)}</span></div>`
          : ''}
        ${preview.cancelled > 0 ? `<p class="hint">${preview.cancelled} venta(s) cancelada(s), no incluidas.</p>` : ''}
        ${preview.previous ? `<p class="hint">Ya hay un corte de este día a las ${preview.previous.created_at.slice(11, 16)}. Este quedará como un corte adicional.</p>` : ''}
      </div>

      <form id="cut-form" class="form-grid" style="margin-top:18px">
        <label class="field">
          <span>Fondo inicial en caja</span>
          <input name="opening" inputmode="decimal" autocomplete="off" value="0.00" />
          <span class="hint">Con lo que abriste el día.</span>
        </label>
        <label class="field">
          <span>Efectivo contado</span>
          <input name="counted" inputmode="decimal" autocomplete="off" value="0.00" />
          <span class="hint">Lo que hay físicamente en el cajón.</span>
        </label>
        <label class="field full">
          <span>Notas</span>
          <input name="notes" autocomplete="off" placeholder="Incidencias, diferencias, turno…" />
        </label>
      </form>

      <div class="arqueo">
        <div class="totals-row"><span>Fondo inicial</span><span id="cut-opening">${formatMoney(0)}</span></div>
        <div class="totals-row"><span>Ventas en efectivo</span><span id="cut-cash">${formatMoney(preview.cashSales)}</span></div>
        <div class="totals-row grand"><span>Debería haber</span><strong id="cut-expected">${formatMoney(preview.expectedCash)}</strong></div>
        <div class="change-box" id="cut-diff-box"><span id="cut-diff-label">Diferencia</span><strong id="cut-diff">${formatMoney(0)}</strong></div>
      </div>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn primary" type="submit" form="cut-form">Registrar corte</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#cut-form')
      const $ = (id) => dialog.querySelector(id)

      const refresh = () => {
        opening = parseMoney(form.opening.value) ?? 0
        counted = parseMoney(form.counted.value) ?? 0
        form.opening.setAttribute('aria-invalid', parseMoney(form.opening.value) === null)
        form.counted.setAttribute('aria-invalid', parseMoney(form.counted.value) === null)

        const expected = opening + preview.cashSales
        const diff = counted - expected
        $('#cut-opening').textContent = formatMoney(opening)
        $('#cut-expected').textContent = formatMoney(expected)
        $('#cut-diff').textContent = formatMoney(Math.abs(diff))
        $('#cut-diff-label').textContent = diff === 0 ? 'Cuadra exacto' : diff > 0 ? 'Sobrante' : 'Faltante'
        $('#cut-diff-box').classList.toggle('short', diff < 0)
      }

      form.addEventListener('input', refresh)
      refresh()

      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (parseMoney(form.opening.value) === null || parseMoney(form.counted.value) === null) return
        try {
          const cut = await window.api.cashCuts.create({
            businessDate: preview.businessDate,
            opening,
            countedCash: counted,
            notes: form.notes.value.trim() || null
          })
          close(cut)
        } catch (err) {
          toast(err.message, 'error')
        }
      })

      form.opening.focus()
      form.opening.select()
    }
  })
}
