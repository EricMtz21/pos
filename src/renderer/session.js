import { can } from '../shared/business/permissions.js'

// Copia local del estado de sesión. Es solo para decidir qué mostrar:
// el proceso principal vuelve a comprobar cada permiso antes de ejecutar nada.
let state = { required: false, user: null, role: null }

export async function refreshSession() {
  state = await window.api.auth.state()
  return state
}

export const session = () => state

/** ¿Conviene ofrecer esta acción en la interfaz? */
export const allowed = (action) => can(state.role, action)

/** Nombre para mostrar, o null si la app corre sin usuarios. */
export const currentUserName = () => state.user?.name ?? null
