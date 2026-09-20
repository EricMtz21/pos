import { calculateTotals } from '../../../shared/business/totals.js'
import { calculateCommission, isCardMethod, periodStart } from '../../../shared/business/commission.js'

const folioFor = (db, date) => {
  const day = date.replace(/-/g, '')
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM sales WHERE folio LIKE ?").get(`V${day}-%`)
  return `V${day}-${String(count + 1).padStart(4, '0')}`
}

const today = () => new Date().toLocaleDateString('en-CA') // 'YYYY-MM-DD' local

export function createSalesRepo(db, { settings, products, audit }) {
  /** Volumen cobrado con tarjeta en el periodo en curso, para elegir el tramo de comisión. */
  function cardVolume(period) {
    const { total } = db
      .prepare(
        `SELECT COALESCE(SUM(p.amount), 0) AS total
         FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE p.method IN ('debit', 'credit') AND s.status = 'completed' AND s.created_at >= ?`
      )
      .get(periodStart(period))
    return total
  }

  function get(id) {
    const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(id)
    if (!sale) return null
    return {
      ...sale,
      items: db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(id),
      payments: db.prepare('SELECT * FROM payments WHERE sale_id = ? ORDER BY id').all(id)
    }
  }

  /**
   * Cobra una venta completa. Todo ocurre en una transacción: o se guarda la venta con su
   * stock descontado y sus movimientos, o no se guarda nada.
   *
   * Nota: NO se bloquea vender por encima del stock. En el mostrador, frenar una venta porque
   * el conteo está mal es peor que dejar el stock en negativo; la UI avisa y el inventario se ajusta.
   *
   * @param items    [{ productId, qty, unitPrice, discount? }] unitPrice en centavos
   * @param payments [{ method, amount }] — deben sumar exactamente el total
   */
  function create({ items, payments, discount = 0, cashReceived = null, userId = null }) {
    if (!items?.length) throw new Error('La venta no tiene productos')
    if (!payments?.length) throw new Error('Falta el método de pago')

    return db.transaction(() => {
      // El nombre y la tasa de impuesto se toman del producto, no del carrito.
      const resolved = items.map((item) => {
        const product = products.get(item.productId)
        if (!product) throw new Error(`Producto no encontrado: ${item.productId}`)
        if (!(item.qty > 0)) throw new Error(`Cantidad inválida para ${product.name}`)
        return { ...item, name: product.name, taxRate: product.tax_rate, unit: product.unit }
      })

      const totals = calculateTotals(resolved, { discount })

      const paid = payments.reduce((sum, p) => sum + p.amount, 0)
      if (paid !== totals.total) {
        throw new Error(`Los pagos suman ${paid / 100} y el total es ${totals.total / 100}`)
      }

      // Comisión por cada cobro con tarjeta, con el volumen acumulado ANTES de esta venta.
      const config = settings.get('cardCommission')
      const volume = config?.enabled ? cardVolume(config.period) : 0
      const commissions = payments
        .filter((p) => isCardMethod(p.method))
        .map((p) => calculateCommission({ config, method: p.method, amount: p.amount, volume }))
      const commissionAmount = commissions.reduce((sum, c) => sum + c.amount, 0)
      // Tasa representativa para el histórico; con pago mixto se guarda la efectiva.
      const cardTotal = payments.filter((p) => isCardMethod(p.method)).reduce((s, p) => s + p.amount, 0)
      const commissionRate = cardTotal ? Number(((commissionAmount / cardTotal) * 100).toFixed(4)) : 0

      const cashApplied = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
      const change = cashReceived === null ? null : cashReceived - cashApplied
      if (change !== null && change < 0) throw new Error('El efectivo recibido es menor al importe en efectivo')

      const method = payments.length === 1 ? payments[0].method : 'mixed'
      const folio = folioFor(db, today())

      const { lastInsertRowid } = db
        .prepare(
          `INSERT INTO sales (folio, subtotal, discount, tax, total, payment_method, cash_received,
                              change_amount, card_commission_rate, card_commission_amount, net_total, user_id)
           VALUES (@folio, @subtotal, @discount, @tax, @total, @method, @cashReceived,
                   @change, @rate, @commission, @netTotal, @userId)`
        )
        .run({
          folio,
          subtotal: totals.subtotal,
          discount: totals.discount,
          tax: totals.tax,
          total: totals.total,
          method,
          cashReceived,
          change,
          rate: commissionRate,
          commission: commissionAmount,
          netTotal: totals.total - commissionAmount,
          userId
        })
      const saleId = Number(lastInsertRowid)

      const insertItem = db.prepare(
        `INSERT INTO sale_items (sale_id, product_id, name_snapshot, qty, unit_price, discount, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      const insertPayment = db.prepare('INSERT INTO payments (sale_id, method, amount) VALUES (?, ?, ?)')
      const moveStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?")
      const insertMove = db.prepare(
        "INSERT INTO inventory_moves (product_id, type, qty, reason, user_id) VALUES (?, 'sale', ?, ?, ?)"
      )

      for (const line of totals.lines) {
        insertItem.run(saleId, line.productId, line.name, line.qty, line.unitPrice, line.discount, line.lineTotal)
        moveStock.run(line.qty, line.productId)
        insertMove.run(line.productId, -line.qty, folio, userId)
      }
      for (const p of payments) insertPayment.run(saleId, p.method, p.amount)

      audit.log({ entity: 'sale', entityId: saleId, action: 'create', after: { folio, total: totals.total }, userId })
      return get(saleId)
    })()
  }

  /** Cancela una venta completada y repone el stock. */
  function cancel(id, { userId = null, reason = null } = {}) {
    return db.transaction(() => {
      const sale = get(id)
      if (!sale) throw new Error('Venta no encontrada')
      if (sale.status !== 'completed') throw new Error('La venta ya no está activa')

      const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
      const insertMove = db.prepare(
        "INSERT INTO inventory_moves (product_id, type, qty, reason, user_id) VALUES (?, 'return', ?, ?, ?)"
      )
      for (const item of sale.items) {
        if (item.product_id === null) continue // producto borrado: no hay a qué reponer
        restore.run(item.qty, item.product_id)
        insertMove.run(item.product_id, item.qty, reason ?? `Cancelación ${sale.folio}`, userId)
      }

      db.prepare("UPDATE sales SET status = 'cancelled' WHERE id = ?").run(id)
      audit.log({ entity: 'sale', entityId: id, action: 'cancel', before: { status: 'completed' }, after: { status: 'cancelled', reason }, userId })
      return get(id)
    })()
  }

  return {
    get,
    create,
    cancel,
    cardVolume,

    last() {
      const row = db.prepare("SELECT id FROM sales WHERE status = 'completed' ORDER BY id DESC LIMIT 1").get()
      return row ? get(row.id) : null
    },

    list({ from = today(), to = today(), limit = 200 } = {}) {
      return db
        .prepare(
          `SELECT * FROM sales
           WHERE date(created_at) BETWEEN @from AND @to
           ORDER BY id DESC LIMIT @limit`
        )
        .all({ from, to, limit })
    },

    /** Vista previa de la comisión que se aplicaría, para mostrarla antes de cobrar. */
    previewCommission({ method, amount }) {
      const config = settings.get('cardCommission')
      const volume = config?.enabled ? cardVolume(config.period) : 0
      return { ...calculateCommission({ config, method, amount, volume }), volume, enabled: Boolean(config?.enabled) }
    }
  }
}
