// Constantes compartidas entre main, preload y renderer.

export const PAYMENT_METHODS = ['cash', 'debit', 'credit', 'transfer']
export const SALE_STATUSES = ['completed', 'cancelled', 'refunded']
export const ROLES = ['admin', 'cashier']
export const MOVE_TYPES = ['in', 'out', 'adjust', 'sale', 'return']
export const THEMES = ['light', 'dark', 'system']

// Configuración por defecto. La tabla `settings` guarda cada clave de primer nivel como JSON;
// lo que no esté guardado se toma de aquí.
export const SETTINGS_DEFAULTS = {
  theme: 'system',
  accent: '#3B82F6',
  lowStockThreshold: 5,
  business: { name: 'Mi Negocio', address: '', taxId: '', phone: '', footer: '¡Gracias por su compra!' },
  ticket: { width: 58, autoPrint: false, printer: '' },
  // Ver §7 del documento. Desactivada hasta confirmar las reglas con Eric.
  cardCommission: {
    enabled: false,
    period: 'monthly', // daily | weekly | monthly
    applyIvaOnCommission: false,
    byMethod: {
      credit: { tiers: [{ min: 0, pct: 4 }, { min: 10000000, pct: 3 }] },
      debit: { tiers: [{ min: 0, pct: 4 }, { min: 10000000, pct: 3 }] }
    }
  }
}
