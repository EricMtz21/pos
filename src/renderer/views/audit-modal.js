import { openModal } from '../components/modal.js'
import { formatMoney } from '../../shared/money.js'

const escape = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

const ENTITIES = { product: 'Producto', sale: 'Venta', return: 'Devolución', cash_cut: 'Corte', user: 'Usuario' }
const ACTIONS = {
  create: 'Alta',
  update: 'Cambio',
  stock: 'Stock',
  cancel: 'Cancelación',
  login: 'Acceso'
}

// Campos cuyo cambio vale la pena leer, con cómo mostrarlos.
const TRACKED = {
  price_gross: { label: 'Precio', format: formatMoney },
  price_net: { label: 'Sin IVA', format: formatMoney },
  cost: { label: 'Costo', format: formatMoney },
  stock: { label: 'Stock', format: String },
  name: { label: 'Nombre', format: String },
  active: { label: 'Activo', format: (v) => (v ? 'sí' : 'no') },
  role: { label: 'Rol', format: (r) => (r === 'admin' ? 'administrador' : 'cajero') }
}

/** Resume qué cambió entre el antes y el después, en vez de volcar dos JSON. */
function describe(entry) {
  const before = entry.before_json && JSON.parse(entry.before_json)
  const after = entry.after_json && JSON.parse(entry.after_json)

  if (!before && after) {
    return escape(after.name ?? after.folio ?? '')
  }
  if (!before || !after) return ''

  const cambios = Object.entries(TRACKED)
    .filter(([key]) => key in before && key in after && before[key] !== after[key])
    .map(([key, { label, format }]) => `${label}: ${escape(format(before[key]))} → <strong>${escape(format(after[key]))}</strong>`)

  return cambios.join(' · ') || '<span class="muted">sin cambios visibles</span>'
}

/** Historial de la aplicación (§5.5). Si se pasa un producto, solo el suyo. */
export async function showAudit({ entity, entityId, title = 'Actividad reciente' } = {}) {
  const entries = await window.api.audit.list({ entity, entityId, limit: 150 })

  const rows = entries.length
    ? entries
        .map(
          (e) => `<tr>
            <td class="muted">${e.created_at.slice(5, 16).replace(' ', ' · ')}</td>
            <td>${ENTITIES[e.entity] ?? escape(e.entity)}</td>
            <td>${ACTIONS[e.action] ?? escape(e.action)}</td>
            <td>${describe(e)}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="4" class="muted" style="padding:24px;text-align:center">Todavía no hay actividad registrada.</td></tr>'

  return openModal({
    title,
    body: `<div class="table-wrap" style="max-height:60vh"><table>
             <thead><tr><th>Cuándo</th><th>Qué</th><th>Acción</th><th>Detalle</th></tr></thead>
             <tbody>${rows}</tbody>
           </table></div>`,
    footer: '<button class="btn primary" type="button" data-close>Cerrar</button>'
  })
}

/** Historial de un producto: cambios de precio y movimientos de inventario juntos. */
export async function showProductHistory(product) {
  const [cambios, movimientos] = await Promise.all([
    window.api.products.history(product.id),
    window.api.products.moves(product.id, 100)
  ])

  const eventos = [
    ...cambios.map((c) => ({ at: c.created_at, tipo: 'Cambio', detalle: describe(c) })),
    ...movimientos.map((m) => ({
      at: m.created_at,
      tipo: 'Inventario',
      detalle: `${m.qty > 0 ? '+' : ''}${m.qty} ${escape(product.unit)}${m.reason ? ` · ${escape(m.reason)}` : ''}`
    }))
  ].sort((a, b) => b.at.localeCompare(a.at))

  return openModal({
    title: `Historial · ${product.name}`,
    body: `<div class="table-wrap" style="max-height:60vh"><table>
             <thead><tr><th>Cuándo</th><th>Tipo</th><th>Detalle</th></tr></thead>
             <tbody>${
               eventos.length
                 ? eventos
                     .map(
                       (e) => `<tr><td class="muted">${e.at.slice(5, 16).replace(' ', ' · ')}</td>
                               <td>${e.tipo}</td><td>${e.detalle}</td></tr>`
                     )
                     .join('')
                 : '<tr><td colspan="3" class="muted" style="padding:24px;text-align:center">Sin movimientos.</td></tr>'
             }</tbody>
           </table></div>`,
    footer: '<button class="btn primary" type="button" data-close>Cerrar</button>'
  })
}
