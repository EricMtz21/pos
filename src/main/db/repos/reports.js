// Consultas de reportes. Todas excluyen las ventas canceladas y trabajan en centavos.
// Rango inclusivo por fecha local: `from` y `to` son 'YYYY-MM-DD'.
//
// Una venta devuelta (status 'refunded') sigue contando como venta: el dinero entró de
// verdad, y la devolución se resta aparte. Filtrar solo por 'completed' la hacía
// desaparecer del bruto mientras su devolución se seguía restando, y una venta devuelta
// por completo acababa reportando un neto negativo: dinero perdido que nunca se ganó.
const RANGE = `date(s.created_at) BETWEEN @from AND @to AND s.status <> 'cancelled'`

export function createReportsRepo(db, { returns }) {
  /**
   * Ganancia del periodo: lo que entró sin IVA menos lo que costó comprarlo.
   *
   * El impuesto no es ganancia (se cobra para enterarlo), así que el ingreso se toma sin
   * IVA; el costo de compra ya está sin IVA. Las devoluciones se restan del ingreso y
   * devuelven su costo: la mercancía volvió al anaquel.
   *
   * Las líneas vendidas antes de que se congelara el costo (migración 5) no tienen
   * costo y no se pueden valorar. Se cuentan aparte en `costUnknown` en vez de contarlas
   * como costo cero, que haría pasar por ganancia lo que no se sabe.
   */
  function profit({ from, to }) {
    const vendido = db
      .prepare(
        `SELECT
           COALESCE(SUM(CAST(ROUND((si.line_total - si.discount_share) / (1 + COALESCE(si.tax_rate, 0))) AS INTEGER)), 0) AS netRevenue,
           COALESCE(SUM(si.cost * si.qty), 0)  AS cost,
           COALESCE(SUM(si.cost IS NULL), 0)   AS costUnknown
         FROM sale_items si JOIN sales s ON s.id = si.sale_id
         WHERE ${RANGE}`
      )
      .get({ from, to })

    // Las devoluciones se cuentan en la fecha en que se devolvió, no en la de la venta:
    // es cuando el dinero salió de la caja.
    const devuelto = db
      .prepare(
        `SELECT
           COALESCE(SUM(CAST(ROUND(ri.line_total / (1 + COALESCE(si.tax_rate, 0))) AS INTEGER)), 0) AS netRevenue,
           COALESCE(SUM(si.cost * ri.qty), 0) AS cost
         FROM return_items ri
           JOIN sale_items si ON si.id = ri.sale_item_id
           JOIN returns r ON r.id = ri.return_id
         WHERE date(r.created_at) BETWEEN @from AND @to`
      )
      .get({ from, to })

    const netRevenue = vendido.netRevenue - devuelto.netRevenue
    const cost = vendido.cost - devuelto.cost
    return { netRevenue, cost, profit: netRevenue - cost, costUnknown: vendido.costUnknown }
  }

  return {
    /**
     * Totales del periodo: bruto, comisiones, devoluciones y neto realmente recibido.
     * Las devoluciones se restan del neto: es dinero que salió de la caja.
     */
    summary({ from, to }) {
      const base = db
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

      const refunded = returns.totalInRange({ from, to })
      return { ...base, returns: refunded, net: base.net - refunded, ...profit({ from, to }) }
    },

    profit,

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
    sales({ from, to, folio = '', limit = 1000 }) {
      // Buscar por folio ignora el rango: quien busca un ticket concreto no sabe de
      // qué día fue, y obligarle a acertar la fecha haría inútil la búsqueda.
      const texto = String(folio).trim()
      return db
        .prepare(
          `SELECT s.*, u.name AS user_name,
                  (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS items
           FROM sales s LEFT JOIN users u ON u.id = s.user_id
           WHERE (@folio != '' OR date(s.created_at) BETWEEN @from AND @to)
             AND (@folio = '' OR s.folio LIKE @like)
           ORDER BY s.id DESC LIMIT @limit`
        )
        .all({ from, to, folio: texto, like: `%${texto}%`, limit })
    }
  }
}
