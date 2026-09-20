// Corte de caja: arqueo del efectivo al cerrar el día.
//
// El esperado en cajón = fondo inicial + lo cobrado en efectivo. Se usa el importe
// APLICADO de cada pago (payments.amount), no lo recibido: el cambio ya salió del cajón.

const today = () => new Date().toLocaleDateString('en-CA')

export function createCashCutsRepo(db, { audit }) {
  const cashSales = (businessDate) =>
    db
      .prepare(
        `SELECT COALESCE(SUM(p.amount), 0) AS total
         FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE p.method = 'cash' AND s.status = 'completed' AND date(s.created_at) = ?`
      )
      .get(businessDate).total

  /** Lo que el cajero ve antes de contar: totales del día y efectivo esperado. */
  function preview({ businessDate = today(), opening = 0 } = {}) {
    const byMethod = db
      .prepare(
        `SELECT p.method, COUNT(*) AS payments, COALESCE(SUM(p.amount), 0) AS total,
                COALESCE(SUM(p.commission_amount), 0) AS commission
         FROM payments p JOIN sales s ON s.id = p.sale_id
         WHERE s.status = 'completed' AND date(s.created_at) = ?
         GROUP BY p.method ORDER BY total DESC`
      )
      .all(businessDate)

    const totals = db
      .prepare(
        `SELECT COUNT(*) AS sales, COALESCE(SUM(total), 0) AS gross,
                COALESCE(SUM(card_commission_amount), 0) AS commission,
                COALESCE(SUM(net_total), 0) AS net
         FROM sales WHERE status = 'completed' AND date(created_at) = ?`
      )
      .get(businessDate)

    const cancelled = db
      .prepare("SELECT COUNT(*) AS n FROM sales WHERE status = 'cancelled' AND date(created_at) = ?")
      .get(businessDate).n

    const cash = cashSales(businessDate)
    return {
      businessDate,
      opening,
      cashSales: cash,
      expectedCash: opening + cash,
      byMethod,
      cancelled,
      previous: db
        .prepare('SELECT * FROM cash_cuts WHERE business_date = ? ORDER BY id DESC LIMIT 1')
        .get(businessDate) ?? null,
      ...totals
    }
  }

  return {
    preview,

    /**
     * Registra el corte. `countedCash` es lo que el cajero contó físicamente;
     * la diferencia positiva es sobrante y la negativa, faltante.
     */
    create({ businessDate = today(), opening = 0, countedCash = 0, notes = null, userId = null } = {}) {
      if (!Number.isInteger(opening) || opening < 0) throw new Error('El fondo inicial debe ser un entero en centavos (>= 0)')
      if (!Number.isInteger(countedCash) || countedCash < 0) throw new Error('El efectivo contado debe ser un entero en centavos (>= 0)')

      return db.transaction(() => {
        const expected = opening + cashSales(businessDate)
        const difference = countedCash - expected
        const { lastInsertRowid } = db
          .prepare(
            `INSERT INTO cash_cuts (business_date, opening, expected_cash, counted_cash, difference, notes, user_id)
             VALUES (@businessDate, @opening, @expected, @countedCash, @difference, @notes, @userId)`
          )
          .run({ businessDate, opening, expected, countedCash, difference, notes, userId })

        const cut = db.prepare('SELECT * FROM cash_cuts WHERE id = ?').get(Number(lastInsertRowid))
        audit.log({ entity: 'cash_cut', entityId: cut.id, action: 'create', after: cut, userId })
        return cut
      })()
    },

    list(limit = 60) {
      return db.prepare('SELECT * FROM cash_cuts ORDER BY business_date DESC, id DESC LIMIT ?').all(limit)
    }
  }
}
