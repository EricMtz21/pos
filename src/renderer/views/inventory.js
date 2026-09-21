import { icon, hydrateIcons } from '../icons.js'
import { register, kbd } from '../shortcuts/index.js'
import { onScan } from '../scanner.js'
import { toast } from '../components/toast.js'
import { confirmModal } from '../components/modal.js'
import { openProductForm, openStockForm } from './product-form.js'
import { showProductHistory } from './audit-modal.js'
import { allowed } from '../session.js'
import { barcodeSvg } from '../components/barcode.js'
import { formatMoney, margin } from '../../shared/money.js'

const escape = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

function rowHtml(p) {
  const m = margin(p.price_net, p.cost)
  return `<tr data-id="${p.id}">
    <td class="muted">${escape(p.code) || '—'}</td>
    <td>${escape(p.name)}</td>
    <td class="num">${formatMoney(p.price_gross)}</td>
    <td class="num muted">${formatMoney(p.price_net)}</td>
    <td class="num muted">${m === null ? '—' : `${m.toFixed(0)} %`}</td>
    <td class="num">
      ${p.low_stock ? `<span class="badge warn">${icon('triangle-alert')}${p.stock}</span>` : p.stock}
    </td>
    <td>
      <div class="row-actions">
        <button class="btn ghost icon-only" data-act="history" title="Historial">${icon('info')}</button>
        ${
          allowed('products:update')
            ? `<button class="btn ghost icon-only" data-act="stock" title="Ajustar stock">${icon('package')}</button>
               <button class="btn ghost icon-only" data-act="edit" title="Editar">${icon('pencil')}</button>
               <button class="btn ghost icon-only danger" data-act="remove" title="Desactivar">${icon('trash-2')}</button>`
            : ''
        }
      </div>
    </td>
  </tr>`
}

/**
 * Pantalla sin filas. Cada caso dice algo distinto: un inventario recién instalado no
 * es lo mismo que una búsqueda sin resultados, y no encontrar nada por reponer es una
 * buena noticia, no un vacío.
 */
function emptyHtml(filtros) {
  const caso = filtros.lowStockOnly
    ? ['Nada por reponer', 'Ningún producto activo está por debajo de su mínimo.']
    : filtros.text
      ? ['Sin coincidencias', `Ningún producto con «${escape(filtros.text)}» en el nombre o el código.`]
      // Sin filtros y sin filas: no hay nada dado de alta todavía.
      : ['El inventario está vacío', 'Escanea un producto con el lector para darlo de alta, o usa «Nuevo producto».']

  return `<tr><td colspan="7">
    <div class="inv-empty">
      <div class="box-stack" aria-hidden="true">
        <span class="box box-back"></span>
        <span class="box box-front">
          <span class="box-label">${barcodeSvg(12)}</span>
        </span>
        <span class="box-shelf"></span>
      </div>
      <p class="inv-empty-title">${caso[0]}</p>
      <p class="hint">${caso[1]}</p>
    </div>
  </td></tr>`
}

export async function renderInventory(container) {
  const settings = await window.api.settings.get()
  const filters = { text: '', lowStockOnly: false }

  container.innerHTML = `
    <div class="toolbar">
      <div class="search">
        ${icon('search')}
        <input id="inv-search" type="search" placeholder="Buscar por nombre o código…" autocomplete="off" aria-label="Buscar productos" />
      </div>
      <button class="btn" id="inv-low" type="button">${icon('triangle-alert')}Stock bajo</button>
      ${
        allowed('products:create')
          ? `<button class="btn primary" id="inv-new" type="button">${icon('plus')}Nuevo producto ${kbd('Ctrl+N')}</button>`
          : ''
      }
    </div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Código</th><th>Producto</th>
            <th class="num">Precio</th><th class="num">Sin IVA</th><th class="num">Margen</th>
            <th class="num">Stock</th><th></th>
          </tr>
        </thead>
        <tbody id="inv-rows"></tbody>
      </table>
    </div>`
  hydrateIcons(container)

  const search = container.querySelector('#inv-search')
  const tbody = container.querySelector('#inv-rows')
  const lowBtn = container.querySelector('#inv-low')

  async function refresh() {
    const products = await window.api.products.search(filters)
    tbody.innerHTML = products.length
      ? products.map(rowHtml).join('')
      : emptyHtml(filters)
    hydrateIcons(tbody)
  }

  async function create() {
    const data = await openProductForm({ product: null, lowStockThreshold: settings.lowStockThreshold })
    if (!data) return
    try {
      const saved = await window.api.products.create(data)
      toast(`Producto creado: ${saved.name}`)
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function edit(product) {
    const data = await openProductForm({ product, lowStockThreshold: settings.lowStockThreshold })
    if (!data) return
    try {
      await window.api.products.update(product.id, data)
      toast('Producto actualizado')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function adjust(product) {
    const move = await openStockForm(product)
    if (!move) return
    try {
      const after = await window.api.products.adjustStock({ productId: product.id, ...move })
      toast(`Stock de ${after.name}: ${after.stock}`)
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function remove(product) {
    const ok = await confirmModal({
      title: 'Desactivar producto',
      message: `«${product.name}» dejará de aparecer en ventas e inventario. Las ventas anteriores lo conservan y puedes reactivarlo después.`,
      confirmLabel: 'Desactivar',
      danger: true
    })
    if (!ok) return
    try {
      await window.api.products.deactivate(product.id)
      toast('Producto desactivado')
      await refresh()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  // Búsqueda con debounce corto: escribir no dispara una consulta por tecla.
  let timer
  search.addEventListener('input', () => {
    clearTimeout(timer)
    filters.text = search.value
    timer = setTimeout(refresh, 120)
  })

  lowBtn.addEventListener('click', () => {
    filters.lowStockOnly = !filters.lowStockOnly
    lowBtn.classList.toggle('primary', filters.lowStockOnly)
    refresh()
  })

  container.querySelector('#inv-new')?.addEventListener('click', create)

  tbody.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]')
    if (!btn) return
    const id = Number(btn.closest('tr').dataset.id)
    const product = (await window.api.products.search({ ...filters, limit: 1000 })).find((p) => p.id === id)
    if (!product) return
    ;({ stock: adjust, edit, remove, history: showProductHistory }[btn.dataset.act])(product)
  })

  await refresh()

  // Atajos de esta vista; se sueltan al salir de ella.
  const disposers = [
    // Aquí escanear no vende: abre el producto para editarlo, o lo da de alta con
    // el código ya puesto, que es justo lo que se hace con un artículo nuevo en mano.
    onScan(async (code) => {
      const producto = await window.api.products.findByCode(code)
      if (producto) {
        if (allowed('products:update')) return edit(producto)
        search.value = code
        filters.text = code
        return refresh()
      }
      if (!allowed('products:create')) return toast(`Sin producto con el código ${code}`, 'error')
      const data = await openProductForm({ product: { code }, lowStockThreshold: settings.lowStockThreshold })
      if (!data) return
      try {
        const saved = await window.api.products.create(data)
        toast(`Producto creado: ${saved.name}`)
        await refresh()
      } catch (err) {
        toast(err.message, 'error')
      }
    }),
    register('F3', () => search.select(), 'Buscar producto'),
    ...(allowed('products:create') ? [register('Ctrl+N', create, 'Nuevo producto')] : [])
  ]
  return () => disposers.forEach((off) => off())
}
