// Consultas de reportes. Todas excluyen las ventas canceladas y trabajan en centavos.
// Rango inclusivo por fecha local: `from` y `to` son 'YYYY-MM-DD'.

const RANGE = `date(s.created_at) BETWEEN @from AND @to AND s.status = 'completed'`

export function createReportsRepo(db) {
  return {
    /** Totales del periodo: bruto, comisiones y neto realmente recibido. */
    summary({ from, to }) {
      return db
        .prepare(
          `SELECT
             COUNT(*)                                    AS sales,
             COALESCE(SUM(s.total), 0)                   AS gross,
             COALESCE(SUM(s.discount), 0)                AS discounts,
             COALESCE(SUM(s.tax), 0)                     AS tax,
             COALESCE(SUM(s.card_commission_amount), 0)  AS commission,
             COALESCE(SUM(s.net_total), 0)               AS net,
             CAST(COALESCE(AVG(s.total), 0) AS INTEGER)  AS averageTicket
           FROM sales s WHERE ${RANGE}`
        )
        .get({ from, to })
    },

    /** Desglose por método de pago (§5.3). La comisión sale de cada pago, no de la venta,
     *  para que un pago mixto se reparta correctamente entre efectivo y tarjeta. */
    byMethod({ from, to }) {
      return db
        .prepare(
          `SELECT
             p.method,
             COUNT(*)                                  AS payments,
             COALESCE(SUM(p.amount), 0)                AS gross,
             COALESCE(SUM(p.commission_amount), 0)     AS commission,
             COALESCE(SUM(p.amount - p.commission_amount), 0) AS net
           FROM payments p JOIN sales s ON s.id = p.sale_id
           WHERE ${RANGE}
           GROUP BY p.method ORDER BY gross DESC`
        )
        .all({ from, to })
    },

    byDay({ from, to }) {
      return db
        .prepare(
          `SELECT
             date(s.created_at)                         AS day,
             COUNT(*)                                   AS sales,
             COALESCE(SUM(s.total), 0)                  AS gross,
             COALESCE(SUM(s.discount), 0)               AS discounts,
             COALESCE(SUM(s.card_commission_amount), 0) AS commission,
             COALESCE(SUM(s.net_total), 0)              AS net
           FROM sales s WHERE ${RANGE}
           GROUP BY day ORDER BY day DESC`
        )
        .all({ from, to })
    },

    /** Ranking de productos. Se agrupa por producto; si fue borrado, por el nombre
     *  que quedó registrado en la venta. Se muestra el nombre actual del producto. */
    topProducts({ from, to, limit = 50 }) {
      return db
        .prepare(
          `SELECT
             COALESCE(pr.name, si.name_snapshot) AS name,
             SUM(si.qty)                          AS qty,
             SUM(si.line_total)                   AS total
           FROM sale_items si
           JOIN sales s ON s.id = si.sale_id
           LEFT JOIN products pr ON pr.id = si.product_id
           WHERE ${RANGE}
           GROUP BY si.product_id, COALESCE(pr.name, si.name_snapshot)
           ORDER BY qty DESC LIMIT @limit`
        )
        .all({ from, to, limit })
    },

    /** Ventas individuales del periodo, para la tabla de detalle y el Excel. */
    sales({ from, to, limit = 1000 }) {
      return db
        .prepare(
          `SELECT s.*, (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items
           FROM sales s
           WHERE date(s.created_at) BETWEEN @from AND @to
           ORDER BY s.id DESC LIMIT @limit`
        )
        .all({ from, to, limit })
    }
  }
}
