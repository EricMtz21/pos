import { openModal } from '../components/modal.js'
import { formatMoney, parseMoney } from '../../shared/money.js'

/**
 * Descuento sobre el total de la venta. Se puede dar en pesos o en porcentaje,
 * porque en el mostrador se dicen las dos cosas: «déjalo en 50» y «hazme el 10 %».
 * Devuelve el descuento en centavos, o null si se cancela.
 */
export function openDiscount({ subtotal, actual = 0 }) {
  return openModal({
    title: 'Descuento de la venta',
    body: `
      <div class="totals-row"><span>Subtotal</span><span>${formatMoney(subtotal)}</span></div>
      <form id="disc-form" class="form-grid" style="margin-top:16px">
        <label class="field">
          <span>En pesos</span>
          <input name="amount" inputmode="decimal" autocomplete="off" value="${actual ? (actual / 100).toFixed(2) : ''}" placeholder="0.00" />
        </label>
        <label class="field">
          <span>O en porcentaje</span>
          <div class="pct"><input name="percent" inputmode="decimal" autocomplete="off" placeholder="0" /><span>%</span></div>
        </label>
      </form>
      <div class="change-box" style="margin-top:16px">
        <span>Total con descuento</span><strong id="disc-total">${formatMoney(subtotal - actual)}</strong>
      </div>
      <p class="errors" id="disc-error"></p>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn ghost danger" type="button" id="disc-clear">Quitar descuento</button>
             <button class="btn primary" type="submit" form="disc-form">Aplicar</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#disc-form')
      let valor = actual

      const pintar = () => {
        const excede = valor > subtotal
        dialog.querySelector('#disc-total').textContent = formatMoney(Math.max(0, subtotal - valor))
        dialog.querySelector('#disc-error').textContent = excede
          ? 'El descuento no puede superar el subtotal.'
          : ''
        dialog.querySelector('[form="disc-form"]').disabled = excede
      }

      // Escribir en un campo vacía el otro: son dos formas de decir lo mismo.
      form.amount.addEventListener('input', () => {
        form.percent.value = ''
        const cents = parseMoney(form.amount.value)
        form.amount.setAttribute('aria-invalid', cents === null)
        valor = cents ?? 0
        pintar()
      })
      form.percent.addEventListener('input', () => {
        form.amount.value = ''
        const pct = Number(form.percent.value)
        const válido = pct >= 0 && pct <= 100
        form.percent.setAttribute('aria-invalid', !válido)
        valor = válido ? Math.round((subtotal * pct) / 100) : 0
        pintar()
      })

      dialog.querySelector('#disc-clear').addEventListener('click', () => close(0))
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        if (valor <= subtotal) close(valor)
      })

      form.amount.focus()
      form.amount.select()
      pintar()
    }
  })
}

/**
 * Precio de una línea del carrito: producto a granel, precio especial o pactado.
 * Devuelve el precio unitario en centavos, o null si se cancela.
 */
export function openLinePrice(line) {
  return openModal({
    title: `Precio · ${line.name}`,
    body: `
      <form id="price-form" class="form-grid">
        <label class="field">
          <span>Precio unitario</span>
          <input name="price" inputmode="decimal" autocomplete="off" value="${(line.unitPrice / 100).toFixed(2)}" />
        </label>
        <div class="field">
          <span>De lista</span>
          <p class="hint">${formatMoney(line.listPrice)}</p>
        </div>
      </form>
      <div class="change-box" style="margin-top:16px">
        <span>Importe de la línea</span><strong id="price-total">${formatMoney(Math.round(line.qty * line.unitPrice))}</strong>
      </div>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn ghost" type="button" id="price-reset">Volver al de lista</button>
             <button class="btn primary" type="submit" form="price-form">Aplicar</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#price-form')
      const refrescar = () => {
        const cents = parseMoney(form.price.value)
        form.price.setAttribute('aria-invalid', cents === null)
        dialog.querySelector('#price-total').textContent =
          cents === null ? '—' : formatMoney(Math.round(line.qty * cents))
        dialog.querySelector('[form="price-form"]').disabled = cents === null
      }
      form.price.addEventListener('input', refrescar)
      dialog.querySelector('#price-reset').addEventListener('click', () => close(line.listPrice))
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const cents = parseMoney(form.price.value)
        if (cents !== null) close(cents)
      })
      form.price.focus()
      form.price.select()
    }
  })
}

/**
 * Venta rápida: una línea suelta que no está en el catálogo.
 *
 * Con piezas únicas siempre acaba llegando algo sin dar de alta, y parar el mostrador
 * para crear un producto que no se va a repetir no tiene sentido. No toca inventario:
 * no hay existencia que descontar de algo que nunca se registró.
 *
 * El costo se pide, pero es opcional: si se sabe, la ganancia del periodo lo refleja;
 * si no, la línea se cuenta aparte en vez de pasar por ganancia pura.
 */
export function openQuickLine() {
  return openModal({
    title: 'Venta rápida',
    body: `
      <form id="quick-form" class="form-grid">
        <label class="field full">
          <span>Concepto *</span>
          <input name="name" autocomplete="off" maxlength="80" placeholder="Lo que se está vendiendo" />
          <span class="hint">Es lo que saldrá en el ticket y en los reportes.</span>
        </label>
        <label class="field">
          <span>Precio con IVA *</span>
          <input name="price" inputmode="decimal" autocomplete="off" placeholder="0.00" />
        </label>
        <label class="field">
          <span>Cantidad</span>
          <input name="qty" inputmode="decimal" autocomplete="off" value="1" />
        </label>
        <label class="field">
          <span>Impuesto</span>
          <select name="taxRate">
            <option value="0.16">IVA 16 %</option>
            <option value="0">Exento</option>
          </select>
        </label>
        <label class="field">
          <span>Costo (opcional)</span>
          <input name="cost" inputmode="decimal" autocomplete="off" placeholder="—" />
          <span class="hint">Lo que costó comprarlo, sin IVA. Solo sirve para la ganancia.</span>
        </label>
      </form>
      <div class="change-box" style="margin-top:16px">
        <span>Importe</span><strong id="quick-total">—</strong>
      </div>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn primary" type="submit" form="quick-form">Agregar al carrito</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#quick-form')
      const aceptar = dialog.querySelector('[form="quick-form"]')

      const leer = () => {
        const price = parseMoney(form.price.value)
        const qty = Number(form.qty.value)
        const cost = form.cost.value.trim() === '' ? null : parseMoney(form.cost.value)
        return {
          name: form.name.value.trim(),
          price,
          qty: Number.isFinite(qty) && qty > 0 ? Number(qty.toFixed(3)) : null,
          cost,
          taxRate: Number(form.taxRate.value)
        }
      }

      const refrescar = () => {
        const v = leer()
        // El costo queda vacío mientras no se escriba; escrito, tiene que ser un importe.
        const costoEscrito = form.cost.value.trim() !== ''
        const valido = Boolean(v.name) && v.price !== null && v.qty !== null && (!costoEscrito || v.cost !== null)
        dialog.querySelector('#quick-total').textContent =
          v.price === null || v.qty === null ? '—' : formatMoney(Math.round(v.qty * v.price))
        form.price.setAttribute('aria-invalid', form.price.value.trim() !== '' && v.price === null)
        form.cost.setAttribute('aria-invalid', costoEscrito && v.cost === null)
        aceptar.disabled = !valido
      }

      for (const campo of ['name', 'price', 'qty', 'cost']) form[campo].addEventListener('input', refrescar)
      refrescar()

      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const v = leer()
        if (!v.name || v.price === null || v.qty === null) return
        close({ name: v.name, unitPrice: v.price, qty: v.qty, taxRate: v.taxRate, cost: v.cost })
      })
      form.name.focus()
    }
  })
}
