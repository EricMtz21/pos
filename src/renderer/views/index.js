import { renderInventory } from './inventory.js'
import { renderSales } from './sales.js'
import { renderReports } from './reports.js'
import { renderSettings } from './settings.js'

// `render(container)` puede devolver una función de limpieza (p. ej. soltar atajos de la vista).
export const views = [
  {
    id: 'sales',
    label: 'Ventas',
    icon: 'shopping-cart',
    keys: 'F2',
    subtitle: 'Cobro rápido con escáner y teclado',
    render: renderSales
  },
  {
    id: 'inventory',
    label: 'Inventario',
    icon: 'package',
    keys: 'Ctrl+I',
    subtitle: 'Productos, stock y alertas',
    render: renderInventory
  },
  {
    id: 'reports',
    label: 'Reportes',
    icon: 'chart-column',
    keys: 'Ctrl+R',
    subtitle: 'Ventas, comisiones y corte de caja',
    render: renderReports
  },
  {
    id: 'settings',
    label: 'Ajustes',
    icon: 'settings',
    keys: 'Ctrl+,',
    subtitle: 'Negocio, comisiones, apariencia y respaldos',
    render: renderSettings
  }
]
