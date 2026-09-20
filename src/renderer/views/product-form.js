import { openModal } from '../components/modal.js'
import { formatMoney, parseMoney, netFromGross, margin } from '../../shared/money.js'

const TAX_RATES = [
  { value: 0.16, label: 'IVA 16 %' },
  { value: 0.08, label: 'IVA 8 % (frontera)' },
  { value: 0, label: 'Exento / 0 %' }
]

const option = (value, label, selected) =>
  `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`

/**
 * Alta y edición de producto. `product` null = alta.
 * Devuelve el producto guardado, o null si se canceló.
 */
export function openProductForm({ product, lowStockThreshold }) {
  const editing = Boolean(product)
  const p = product ?? { tax_rate: 0.16, stock: 0, active: 1 }
  const money = (c) => (c ? (c / 100).toFixed(2) : '')

  return openModal({
    title: editing ? 'Editar producto' : 'Nuevo producto',
    body: `
      <form id="product-form" class="form-grid">
        <label class="field full">
          <span>Código de barras</span>
          <input name="code" value="${p.code ?? ''}" autocomplete="off" placeholder="Escanea con el lector o escríbelo" />
          <span class="hint">Opcional. Con el lector USB: coloca el cursor aquí y escanea.</span>
        </label>

        <label class="field full">
          <span>Nombre *</span>
          <input name="name" value="${(p.name ?? '').replace(/"/g, '&quot;')}" autocomplete="off" required />
        </label>

        <label class="field">
          <span>Precio al público (con IVA) *</span>
          <input name="price_gross" value="${money(p.price_gross)}" inputmode="decimal" autocomplete="off" required />
        </label>

        <label class="field">
          <span>Impuesto</span>
          <select name="tax_rate">${TAX_RATES.map((t) => option(t.value, t.label, p.tax_rate)).join('')}</select>
        </label>

        <label class="field">
          <span>Costo de compra</span>
          <input name="cost" value="${money(p.cost)}" inputmode="decimal" autocomplete="off" />
        </label>

        <div class="field">
          <span>Cálculo</span>
          <p id="derived" class="hint"></p>
        </div>

        <label class="field">
          <span>${editing ? 'Stock actual' : 'Stock inicial'}</span>
          <input name="stock" type="number" step="any" value="${p.stock ?? 0}" ${editing ? 'disabled' : ''} />
          ${editing ? '<span class="hint">Se cambia con «Ajustar stock», que deja registro.</span>' : ''}
        </label>

        <label class="field">
          <span>Stock mínimo</span>
          <input name="min_stock" type="number" step="any" min="0" value="${p.min_stock ?? ''}"
                 placeholder="Global: ${lowStockThreshold}" />
        </label>
      </form>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn primary" type="submit" form="product-form">Guardar</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#product-form')
      const derived = dialog.querySelector('#derived')

      // Muestra en vivo el precio sin IVA y el margen mientras se teclea.
      const refresh = () => {
        const gross = parseMoney(form.price_gross.value)
        const cost = parseMoney(form.cost.value)
        if (gross === null) return (derived.textContent = 'Precio no válido')
        const net = netFromGross(gross, Number(form.tax_rate.value))
        const m = margin(net, cost)
        derived.textContent = `Sin IVA: ${formatMoney(net)}${m === null ? '' : ` · Margen: ${m.toFixed(1)} %`}`
      }
      form.addEventListener('input', refresh)
      form.addEventListener('change', refresh)
      refresh()

      // El lector de barras termina con Enter: en el campo de código eso salta al nombre,
      // no envía el formulario a medio llenar.
      form.code.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          form.name.focus()
        }
      })

      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const gross = parseMoney(form.price_gross.value)
        const cost = parseMoney(form.cost.value)
        for (const [field, value] of [[form.price_gross, gross], [form.cost, cost]]) {
          field.setAttribute('aria-invalid', value === null)
        }
        if (gross === null || cost === null) return

        const taxRate = Number(form.tax_rate.value)
        close({
          code: form.code.value,
          name: form.name.value,
          price_gross: gross,
          price_net: netFromGross(gross, taxRate),
          cost,
          tax_rate: taxRate,
          min_stock: form.min_stock.value === '' ? null : Number(form.min_stock.value),
          ...(editing ? {} : { stock: Number(form.stock.value) || 0 })
        })
      })

      ;(editing ? form.name : form.code).focus()
    }
  })
}

/** Modal de entrada/salida de inventario. Devuelve { delta, type, reason } o null. */
export function openStockForm(product) {
  return openModal({
    title: `Ajustar stock · ${product.name}`,
    body: `
      <form id="stock-form" class="form-grid">
        <p class="hint full">Stock actual: <strong>${product.stock}</strong></p>
        <label class="field">
          <span>Movimiento</span>
          <select name="type">
            <option value="in">Entrada (suma)</option>
            <option value="out">Salida (resta)</option>
          </select>
        </label>
        <label class="field">
          <span>Cantidad</span>
          <input name="qty" type="number" step="any" min="0" value="1" required />
        </label>
        <label class="field full">
          <span>Motivo</span>
          <input name="reason" autocomplete="off" placeholder="Compra a proveedor, merma, conteo físico…" />
        </label>
      </form>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn primary" type="submit" form="stock-form">Aplicar</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#stock-form')
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const qty = Number(form.qty.value)
        if (!(qty > 0)) return form.qty.setAttribute('aria-invalid', 'true')
        close({
          type: form.type.value,
          delta: form.type.value === 'out' ? -qty : qty,
          reason: form.reason.value.trim() || null
        })
      })
      form.qty.select()
    }
  })
}
