// Permisos por rol. Puro y compartido: el proceso principal los aplica (es la autoridad)
// y la interfaz los usa para no ofrecer botones que van a ser rechazados.
//
// Sin usuarios creados la aplicación funciona sin PIN y todo está permitido; los roles
// empiezan a regir en cuanto se da de alta el primer usuario (ver users.isAuthRequired).

const CASHIER_DENIED = new Set([
  'products:create',
  'products:update',
  'products:deactivate',
  'products:adjustStock',
  'settings:set',
  'sales:cancel',
  'returns:create',
  'backup:restore',
  'users:create',
  'users:update',
  'users:deactivate',
  'logo:choose',
  // Abrir el cajón a mano es sacar dinero sin venta de por medio: eso lo autoriza el
  // dueño. El cajón que se abre solo al cobrar en efectivo no pasa por aquí.
  'drawer:open'
])

/** @param role 'admin' | 'cashier' | null (sin sesión y sin usuarios: todo permitido) */
export function can(role, action) {
  if (role === null || role === 'admin') return true
  if (role === 'cashier') return !CASHIER_DENIED.has(action)
  return false
}

/** Acciones vetadas al cajero, para que la interfaz sepa qué ocultar. */
export const deniedForCashier = () => [...CASHIER_DENIED]
