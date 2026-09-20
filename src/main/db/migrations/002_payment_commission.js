// Los reportes desglosan la comisión por método de pago (§5.3). La comisión se guardaba
// solo a nivel venta, así que en un pago mixto no se podía saber cuánto correspondía a
// débito y cuánto a crédito. Ahora cada cobro con tarjeta lleva la suya.
export default {
  version: 2,
  name: 'payment_commission',
  up(db) {
    db.exec(`ALTER TABLE payments ADD COLUMN commission_amount INTEGER NOT NULL DEFAULT 0`)

    // Reparto de lo ya cobrado: a prorrata del importe de cada tarjeta dentro de su venta.
    // Es exacto cuando débito y crédito comparten tasa, que es el caso por configuración.
    db.exec(`
      UPDATE payments
      SET commission_amount = (
        SELECT CAST(ROUND(
          payments.amount * 1.0
          / (SELECT SUM(p2.amount) FROM payments p2
             WHERE p2.sale_id = payments.sale_id AND p2.method IN ('debit', 'credit'))
          * s.card_commission_amount
        ) AS INTEGER)
        FROM sales s WHERE s.id = payments.sale_id
      )
      WHERE method IN ('debit', 'credit')
        AND (SELECT card_commission_amount FROM sales WHERE id = payments.sale_id) > 0
    `)
  }
}
