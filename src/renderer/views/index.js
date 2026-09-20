import { icon } from '../icons.js'

// Vistas del sidebar. Cada fase reemplaza el `render` de su vista por la pantalla real.
export const views = [
  { id: 'sales', label: 'Ventas', icon: 'shopping-cart', keys: 'F2', subtitle: 'Cobro rápido con escáner y teclado', phase: 4 },
  { id: 'inventory', label: 'Inventario', icon: 'package', keys: 'Ctrl+I', subtitle: 'Productos, stock y alertas', phase: 3 },
  { id: 'reports', label: 'Reportes', icon: 'chart-column', keys: 'Ctrl+R', subtitle: 'Ventas, comisiones y corte de caja', phase: 5 },
  { id: 'settings', label: 'Ajustes', icon: 'settings', keys: 'Ctrl+,', subtitle: 'Negocio, comisiones y apariencia', phase: 6 }
]

// Vista provisional. También comprueba de punta a punta renderer → IPC → SQLite.
export async function renderPlaceholder(view, container) {
  const [products, low] = await Promise.all([window.api.products.search({ limit: 1000 }), window.api.products.lowStock()])
  container.innerHTML = `
    <div class="card empty">
      ${icon(view.icon)}
      <h2>${view.label}</h2>
      <p>Esta pantalla se construye en la Fase ${view.phase}.</p>
      <div class="stats">
        <div class="stat"><strong>${products.length}</strong>productos activos</div>
        <div class="stat"><strong>${low.length}</strong>con stock bajo</div>
      </div>
    </div>`
}
