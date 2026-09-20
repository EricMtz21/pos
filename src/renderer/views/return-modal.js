import { openModal } from '../components/modal.js'
import { formatMoney } from '../../shared/money.js'

const METHODS = [
  { id: 'cash', label: 'Efectivo' },
  { id: 'debit', label: 'Tarjeta débito' },
  { id: 'credit', label: 'Tarjeta crédito' },
  { id: 'transfer', label: 'Transferencia' }
]

const escape = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

/**
 * Devolución de una venta. Permite elegir cuántas unidades de cada línea regresan.
 * Devuelve la devolución registrada, o null si se canceló.
 */
export async function openReturn(sale) {
  const items = await window.api.returns.items(sale.id)
  const devolvibles = items.filter((i) => i.remaining > 0)

  if (devolvibles.length === 0) {
    return openModal({
      title: `Devolución · ${sale.folio}`,
      body: '<p class="hint">Esta venta ya se devolvió por completo.</p>',
      footer: '<button class="btn primary" type="button" data-close>Cerrar</button>'
    })
  }

  // Precio unitario ya descontado, que es lo que se regresa por unidad.
  const unitOf = (i) => i.line_total / i.qty
  const cantidades = new Map(devolvibles.map((i) => [i.id, 0]))

  return openModal({
    title: `Devolución · ${sale.folio}`,
    body: `
      <table class="return-items">
        <thead><tr><th>Producto</th><th class="num">Disponible</th><th class="num">Devolver</th><th class="num">Importe</th></tr></thead>
        <tbody>
          ${devolvibles
            .map(
              (i) => `<tr data-item="${i.id}">
                <td>${escape(i.name_snapshot)}</td>
                <td class="num muted">${i.remaining}</td>
                <td class="num"><input type="number" min="0" max="${i.remaining}" step="any" value="0" data-qty="${i.id}" /></td>
                <td class="num" data-amount="${i.id}">${formatMoney(0)}</td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>

      <form id="return-form" class="form-grid" style="margin-top:16px">
        <label class="field"><span>Cómo se le regresa el dinero</span>
          <select name="method">${METHODS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('')}</select></label>
        <label class="field"><span>Motivo</span>
          <input name="reason" autocomplete="off" placeholder="Producto defectuoso, equivocación…" /></label>
      </form>

      <div class="change-box" style="margin-top:16px">
        <span>Total a devolver</span><strong id="return-total">${formatMoney(0)}</strong>
      </div>
      <p class="errors" id="return-error"></p>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn primary" type="button" id="return-confirm" disabled>Registrar devolución</button>`,
    onMount: ({ dialog, close }) => {
      const confirm = dialog.querySelector('#return-confirm')
      const form = dialog.querySelector('#return-form')

      const total = () =>
        devolvibles.reduce((sum, i) => sum + Math.round(unitOf(i) * cantidades.get(i.id)), 0)

      const refresh = () => {
        for (const i of devolvibles) {
          dialog.querySelector(`[data-amount="${i.id}"]`).textContent = formatMoney(
            Math.round(unitOf(i) * cantidades.get(i.id))
          )
        }
        dialog.querySelector('#return-total').textContent = formatMoney(total())
        confirm.disabled = total() <= 0
      }

      dialog.querySelectorAll('[data-qty]').forEach((input) =>
        input.addEventListener('input', () => {
          const id = Number(input.dataset.qty)
          const max = devolvibles.find((i) => i.id === id).remaining
          const qty = Math.min(Math.max(Number(input.value) || 0, 0), max)
          // Se corrige en el campo, para que se vea que hay un tope.
          if (qty !== Number(input.value)) input.value = qty
          cantidades.set(id, qty)
          refresh()
        })
      )

      // Atajo: devolver todo de una vez es el caso más común.
      dialog.querySelector('.modal-head').insertAdjacentHTML(
        'beforeend',
        '<button class="btn ghost" type="button" id="return-all">Devolver todo</button>'
      )
      dialog.querySelector('#return-all').addEventListener('click', () => {
        for (const i of devolvibles) {
          cantidades.set(i.id, i.remaining)
          dialog.querySelector(`[data-qty="${i.id}"]`).value = i.remaining
        }
        refresh()
      })

      confirm.addEventListener('click', async () => {
        const seleccion = devolvibles
          .filter((i) => cantidades.get(i.id) > 0)
          .map((i) => ({ saleItemId: i.id, qty: cantidades.get(i.id) }))
        try {
          confirm.disabled = true
          close(
            await window.api.returns.create({
              saleId: sale.id,
              items: seleccion,
              method: form.method.value,
              reason: form.reason.value.trim() || null
            })
          )
        } catch (err) {
          // El modal sigue abierto para corregir: el error se muestra aquí, no en un toast
          // que quedaría detrás del propio modal.
          dialog.querySelector('#return-error').textContent = err.message
          confirm.disabled = false
        }
      })

      refresh()
    }
  })
}
