// Esquema inicial. Convenciones:
//  - Dinero en INTEGER (centavos). Cantidades de stock en REAL (permite kg, lt).
//  - Fechas en texto local 'YYYY-MM-DD HH:MM:SS' para que los reportes por día sean directos.
export default {
  version: 1,
  name: 'initial',
  up(db) {
    db.exec(`
      CREATE TABLE categories (
        id   INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );

      CREATE TABLE users (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        name     TEXT NOT NULL,
        role     TEXT NOT NULL DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier')),
        pin_hash TEXT,
        active   INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
      );

      CREATE TABLE products (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        code        TEXT UNIQUE,
        name        TEXT NOT NULL,
        price_gross INTEGER NOT NULL DEFAULT 0 CHECK (price_gross >= 0),
        price_net   INTEGER NOT NULL DEFAULT 0 CHECK (price_net >= 0),
        cost        INTEGER NOT NULL DEFAULT 0 CHECK (cost >= 0),
        stock       REAL    NOT NULL DEFAULT 0,
        min_stock   REAL,                       -- NULL = usar el umbral global de ajustes
        unit        TEXT    NOT NULL DEFAULT 'pza',
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        tax_rate    REAL    NOT NULL DEFAULT 0, -- 0.16 = 16 %
        active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
      );
      CREATE INDEX idx_products_name ON products(name);
      CREATE INDEX idx_products_category ON products(category_id);

      CREATE TABLE sales (
        id                     INTEGER PRIMARY KEY AUTOINCREMENT,
        folio                  TEXT NOT NULL UNIQUE,
        created_at             TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        subtotal               INTEGER NOT NULL DEFAULT 0,
        discount               INTEGER NOT NULL DEFAULT 0,
        tax                    INTEGER NOT NULL DEFAULT 0,
        total                  INTEGER NOT NULL DEFAULT 0,
        payment_method         TEXT NOT NULL CHECK (payment_method IN ('cash', 'debit', 'credit', 'transfer', 'mixed')),
        cash_received          INTEGER,
        change_amount          INTEGER,
        -- Se congelan al cobrar para que los reportes históricos no cambien si se edita la configuración.
        card_commission_rate   REAL    NOT NULL DEFAULT 0,
        card_commission_amount INTEGER NOT NULL DEFAULT 0,
        net_total              INTEGER NOT NULL DEFAULT 0,
        status                 TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled', 'refunded')),
        user_id                INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_sales_created_at ON sales(created_at);

      CREATE TABLE sale_items (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        product_id    INTEGER REFERENCES products(id) ON DELETE SET NULL,
        name_snapshot TEXT NOT NULL,
        qty           REAL NOT NULL CHECK (qty > 0),
        unit_price    INTEGER NOT NULL,
        discount      INTEGER NOT NULL DEFAULT 0,
        line_total    INTEGER NOT NULL
      );
      CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);

      CREATE TABLE payments (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
        method  TEXT NOT NULL CHECK (method IN ('cash', 'debit', 'credit', 'transfer')),
        amount  INTEGER NOT NULL
      );
      CREATE INDEX idx_payments_sale ON payments(sale_id);

      CREATE TABLE cash_cuts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        business_date TEXT NOT NULL,            -- 'YYYY-MM-DD' del día que se cierra
        created_at    TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        opening       INTEGER NOT NULL DEFAULT 0,
        expected_cash INTEGER NOT NULL DEFAULT 0,
        counted_cash  INTEGER NOT NULL DEFAULT 0,
        difference    INTEGER NOT NULL DEFAULT 0,
        notes         TEXT,
        user_id       INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_cash_cuts_date ON cash_cuts(business_date);

      CREATE TABLE inventory_moves (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        type       TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust', 'sale', 'return')),
        qty        REAL NOT NULL,               -- con signo: + entra, - sale
        reason     TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        user_id    INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_inventory_moves_product ON inventory_moves(product_id);

      CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL                     -- JSON
      );

      CREATE TABLE audit_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        entity      TEXT NOT NULL,
        entity_id   INTEGER,
        action      TEXT NOT NULL,
        before_json TEXT,
        after_json  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
        user_id     INTEGER REFERENCES users(id)
      );
      CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);

      INSERT INTO categories (name) VALUES ('General'), ('Alimentos'), ('Bebidas'), ('Limpieza'), ('Otros');
    `)
  }
}
