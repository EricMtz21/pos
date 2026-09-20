// Devoluciones parciales o totales de una venta.
//
// El precio que se regresa es el mismo al que se vendió (`sale_items.unit_price`),
// no el precio actual del producto: si subió de precio después, el cliente recibe
// lo que pagó.

const today = () => new Date().toLocaleDateString('en-CA')

export function createReturnsRepo(db, { audit }) {
  const folioFor = () => {
    const day = today().replace(/-/g, '')
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM returns WHERE folio LIKE ?').get(`D${day}-%`)
    return `D${day}-${String(count + 1).padStart(4, '0')}`
  }

  function get(id) {
    const ret = db.prepare('SELECT * FROM returns WHERE id = ?').get(id)
    if (!ret) return null
    return {
      ...ret,
      items: db
        .prepare(
          `SELECT ri.*, si.name_snapshot, si.unit_price
           FROM return_items ri JOIN sale_items si ON si.id = ri.sale_item_id
           WHERE ri.return_id = ? ORDER BY ri.id`
        )
        .all(id)
    }
  }

  /**
   * Líneas de una venta con lo ya devuelto, para saber cuánto se puede devolver todavía.
   */
  function returnableItems(saleId) {
    return db
      .prepare(
        `SELECT si.*,
                COALESCE((SELECT SUM(ri.qty) FROM return_items ri WHERE ri.sale_item_id = si.id), 0) AS returned
         FROM sale_items si WHERE si.sale_id = ? ORDER BY si.id`
      )
      .all(saleId)
      .map((item) => ({ ...item, remaining: item.qty - item.returned }))
  }

  return {
    get,
    returnableItems,

    /**
     * @param saleId
     * @param items  [{ saleItemId, qty }] — qty en unidades, no puede superar lo pendiente
     * @param method cómo se le regresa el dinero al cliente
     */
    create({ saleId, items, method = 'cash', reason = null, userId = null }) {
      if (!items?.length) throw new Error('No se indicó qué devolver')

      return db.transaction(() => {
        const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(saleId)
        if (!sale) throw new Error('Venta no encontrada')
        if (sale.status === 'cancelled') throw new Error('La venta está cancelada: no hay nada que devolver')

        const pendientes = new Map(returnableItems(saleId).map((i) => [i.id, i]))
        const lines = items.map(({ saleItemId, qty }) => {
          const linea = pendientes.get(saleItemId)
          if (!linea) throw new Error('Esa línea no pertenece a la venta')
          if (!(qty > 0)) throw new Error(`Cantidad inválida para ${linea.name_snapshot}`)
          if (qty > linea.remaining + 1e-9) {
            throw new Error(
              `De «${linea.name_snapshot}» solo quedan ${linea.remaining} por devolver (se pidieron ${qty})`
            )
          }
          // Se devuelve la parte proporcional de la línea, descuentos incluidos.
          return { ...linea, qty, lineTotal: Math.round((linea.line_total / linea.qty) * qty) }
        })

        const total = lines.reduce((sum, l) => sum + l.lineTotal, 0)
        const folio = folioFor()

        const { lastInsertRowid } = db
          .prepare(
            `INSERT INTO returns (folio, sale_id, total, method, reason, user_id)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(folio, saleId, total, method, reason, userId)
        const returnId = Number(lastInsertRowid)

        const insertItem = db.prepare(
          'INSERT INTO return_items (return_id, sale_item_id, product_id, qty, line_total) VALUES (?, ?, ?, ?, ?)'
        )
        const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
        const insertMove = db.prepare(
          "INSERT INTO inventory_moves (product_id, type, qty, reason, user_id) VALUES (?, 'return', ?, ?, ?)"
        )

        for (const line of lines) {
          insertItem.run(returnId, line.id, line.product_id, line.qty, line.lineTotal)
          if (line.product_id !== null) {
            restoreStock.run(line.qty, line.product_id)
            insertMove.run(line.product_id, line.qty, `Devolución ${folio}`, userId)
          }
        }

        // Si ya no queda nada por devolver, la venta pasa a «devuelta».
        const quedaAlgo = returnableItems(saleId).some((i) => i.remaining > 1e-9)
        if (!quedaAlgo) db.prepare("UPDATE sales SET status = 'refunded' WHERE id = ?").run(saleId)

        audit.log({
          entity: 'return',
          entityId: returnId,
          action: 'create',
          after: { folio, saleFolio: sale.folio, total, items: lines.length },
          userId
        })
        return get(returnId)
      })()
    },

    list({ from = today(), to = today(), limit = 200 } = {}) {
      return db
        .prepare(
          `SELECT r.*, s.folio AS sale_folio
           FROM returns r JOIN sales s ON s.id = r.sale_id
           WHERE date(r.created_at) BETWEEN @from AND @to
           ORDER BY r.id DESC LIMIT @limit`
        )
        .all({ from, to, limit })
    },

    /** Total devuelto en el periodo, para descontarlo del neto en los reportes. */
    totalInRange({ from, to }) {
      return db
        .prepare('SELECT COALESCE(SUM(total), 0) AS total FROM returns WHERE date(created_at) BETWEEN ? AND ?')
        .get(from, to).total
    }
  }
}
