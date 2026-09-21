// Validación de los ajustes. Pura y compartida: la pantalla la usa para avisar mientras
// se edita, y el proceso principal la aplica antes de guardar. Nunca se confía en la UI.
import { validateTiers } from './commission.js'
import { THEMES } from '../constants.js'

const isString = (v) => typeof v === 'string'
const TICKET_WIDTHS = [58, 80]
const PERIODS = ['daily', 'weekly', 'monthly']

const VALIDATORS = {
  theme: (v) => (THEMES.includes(v) ? [] : [`Tema inválido: ${v}`]),

  accent: (v) => (isString(v) && /^#[0-9a-fA-F]{6}$/.test(v) ? [] : ['El color de acento debe ser #RRGGBB']),

  lowStockThreshold: (v) =>
    Number.isFinite(v) && v >= 0 ? [] : ['El umbral de stock bajo debe ser un número mayor o igual a cero'],

  business: (v) => {
    if (!v || typeof v !== 'object') return ['Los datos del negocio son inválidos']
    const errors = []
    for (const field of ['name', 'address', 'taxId', 'phone', 'footer']) {
      if (field in v && !isString(v[field])) errors.push(`«${field}» debe ser texto`)
    }
    if ('logo' in v && v.logo !== null && !isString(v.logo)) errors.push('La ruta del logo es inválida')
    if (isString(v.name) && v.name.trim() === '') errors.push('El nombre del negocio no puede quedar vacío')
    return errors
  },

  ticket: (v) => {
    if (!v || typeof v !== 'object') return ['La configuración del ticket es inválida']
    const errors = []
    if (!TICKET_WIDTHS.includes(v.width)) errors.push('El ancho del ticket debe ser 58 u 80 mm')
    if ('printer' in v && !isString(v.printer)) errors.push('La impresora debe ser texto')
    return errors
  },

  cashDrawer: (v) => {
    if (!v || typeof v !== 'object') return ['La configuración del cajón es inválida']
    const errors = []
    if (typeof v.enabled !== 'boolean') errors.push('«Abrir el cajón» debe ser sí o no')
    if ('target' in v && !isString(v.target)) errors.push('El destino del cajón debe ser texto')
    if (![0, 1].includes(v.pin)) errors.push('La patilla del cajón debe ser 2 o 5')
    return errors
  },

  cardCommission: (v) => {
    if (!v || typeof v !== 'object') return ['La configuración de comisiones es inválida']
    const errors = []
    if (typeof v.enabled !== 'boolean') errors.push('«Cobrar comisión» debe ser sí o no')
    if (!PERIODS.includes(v.period)) errors.push(`Periodo inválido: ${v.period}`)
    if ('applyIvaOnCommission' in v && typeof v.applyIvaOnCommission !== 'boolean') {
      errors.push('«IVA sobre la comisión» debe ser sí o no')
    }

    // Los tramos solo se revisan con la comisión activa: apagada, da igual cómo queden.
    // Un método sin tramos es válido y significa 0 % para ese método (un negocio puede
    // aceptar solo crédito); lo que no vale es definir tramos y dejarlos mal formados.
    if (v.enabled) {
      for (const [method, label] of [['debit', 'Débito'], ['credit', 'Crédito']]) {
        const tiers = v.byMethod?.[method]?.tiers
        if (tiers) errors.push(...validateTiers(tiers).map((e) => `${label}: ${e.toLowerCase()}`))
      }
    }
    return errors
  }
}

/**
 * @param patch  { clave: valor } con las claves de primer nivel de los ajustes
 * @returns array de mensajes de error; vacío si todo es válido
 */
export function validateSettings(patch) {
  return Object.entries(patch).flatMap(([key, value]) => {
    const validator = VALIDATORS[key]
    return validator ? validator(value) : [`Ajuste desconocido: ${key}`]
  })
}
