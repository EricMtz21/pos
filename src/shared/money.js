// Todo el dinero se guarda y calcula en centavos (enteros) para evitar errores de coma flotante.
// Solo se convierte a pesos al mostrarlo o al leer lo que teclea el usuario.

export const toCents = (pesos) => Math.round(Number(pesos) * 100)

export const fromCents = (cents) => cents / 100

const formatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })

export const formatMoney = (cents) => formatter.format(cents / 100)
