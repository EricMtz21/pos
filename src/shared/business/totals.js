// Cálculo de totales del carrito. Puro y en centavos.
// El IVA va INCLUIDO en `unitPrice` (decisión §14.4): el impuesto no se suma al total,
// se extrae de él para informarlo en el ticket.

/**
 * @param items [{ qty, unitPrice, discount?, taxRate? }]  unitPrice y discount en centavos
 * @param discount  descuento a nivel venta, en centavos
 * @returns { lines, subtotal, discount, tax, total }
 */
export function calculateTotals(items, { discount = 0 } = {}) {
  const lines = items.map((item) => {
    const lineDiscount = item.discount ?? 0
    const gross = Math.round(item.qty * item.unitPrice) - lineDiscount
    if (gross < 0) throw new Error('El descuento de una línea no puede superar su importe')
    return { ...item, discount: lineDiscount, lineTotal: gross }
  })

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0)
  const saleDiscount = Math.min(Math.max(discount, 0), subtotal)
  const total = subtotal - saleDiscount

  // El descuento de venta se reparte a prorrata para saber cuánto queda gravado a cada tasa.
  // El centavo sobrante cae en la última línea, así la suma cuadra exacto con el total.
  let repartido = 0
  lines.forEach((line, i) => {
    line.discountShare =
      subtotal === 0
        ? 0
        : i === lines.length - 1
          ? saleDiscount - repartido
          : Math.round((line.lineTotal / subtotal) * saleDiscount)
    repartido += line.discountShare
  })

  // El IVA se calcula UNA vez por tasa, sobre la base sumada de esa tasa. Hacerlo línea por
  // línea y luego sumar pierde centavos: la suma de redondeos no es el redondeo de la suma.
  const baseByRate = new Map()
  for (const line of lines) {
    const rate = line.taxRate ?? 0
    baseByRate.set(rate, (baseByRate.get(rate) ?? 0) + line.lineTotal - line.discountShare)
  }
  const tax = [...baseByRate].reduce((sum, [rate, base]) => sum + (base - Math.round(base / (1 + rate))), 0)

  return { lines, subtotal, discount: saleDiscount, tax, total }
}
