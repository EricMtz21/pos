// Se congelan en cada línea de venta el costo, la tasa de impuesto y la parte del
// descuento de venta que le tocó, como ya se congelaban el nombre y el precio.
//
// El costo, porque sin él no se puede saber la ganancia de una venta pasada: al cambiar
// el costo del producto cambiaría el margen de todo lo vendido antes.
//
// El descuento repartido, porque la línea guarda su importe ANTES del descuento de la
// venta. Sin ese dato, devolver una venta con descuento regresaba el precio de lista:
// más de lo que el cliente pagó.
//
// El costo NO se rellena hacia atrás: poner el costo de hoy en una venta de hace un mes
// sería inventarse un dato. Esas líneas quedan en NULL y los reportes lo dicen.
// La tasa de impuesto sí se rellena desde el producto: cambia casi nunca, y sin ella no
// se puede quitar el IVA del ingreso para calcular la utilidad.
export default {
  version: 5,
  name: 'costo_por_linea',
  up(db) {
    db.exec(`
      ALTER TABLE sale_items ADD COLUMN cost INTEGER;
      ALTER TABLE sale_items ADD COLUMN tax_rate REAL;
      ALTER TABLE sale_items ADD COLUMN discount_share INTEGER NOT NULL DEFAULT 0;

      UPDATE sale_items
         SET tax_rate = (SELECT p.tax_rate FROM products p WHERE p.id = sale_items.product_id)
       WHERE product_id IS NOT NULL;

      -- El reparto se deriva igual que al cobrar: a prorrata del importe de cada línea.
      -- No es inventarse un dato, es recalcular el que no se había guardado.
      UPDATE sale_items
         SET discount_share = (
           SELECT CAST(ROUND(sale_items.line_total * 1.0 / NULLIF(SUM(si.line_total), 0) * s.discount) AS INTEGER)
             FROM sales s JOIN sale_items si ON si.sale_id = s.id
            WHERE s.id = sale_items.sale_id
         )
       WHERE (SELECT s.discount FROM sales s WHERE s.id = sale_items.sale_id) > 0;
    `)
  }
}
