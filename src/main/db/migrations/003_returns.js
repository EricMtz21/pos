// Devoluciones (§5.5). Una devolución NO borra ni modifica la venta original: se
// registra aparte, apuntando a las líneas devueltas. Así el histórico sigue siendo
// fiel a lo que pasó y los reportes pueden mostrar venta y devolución por separado.
export default {
  version: 3,
  name: 'returns',
  up(db) {
    db.exec(`
      CREATE TABLE returns (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        folio      TEXT NOT NULL UNIQUE,
        sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        total      INTEGER NOT NULL,
        method     TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'credit', 'transfer')),
        reason     TEXT,
        user_id    INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_returns_sale ON returns(sale_id);
      CREATE INDEX idx_returns_created ON returns(created_at);

      CREATE TABLE return_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        return_id    INTEGER NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
        sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
        product_id   INTEGER REFERENCES products(id) ON DELETE SET NULL,
        qty          REAL NOT NULL CHECK (qty > 0),
        line_total   INTEGER NOT NULL
      );
      CREATE INDEX idx_return_items_return ON return_items(return_id);
      CREATE INDEX idx_return_items_sale_item ON return_items(sale_item_id);
    `)
  }
}
