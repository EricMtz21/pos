import { MOVE_TYPES } from '../../../shared/constants.js'

// Este negocio no usa categorías ni unidades: las columnas siguen en el esquema con su
// valor por defecto, pero ya no se escriben ni se leen.
const FIELDS = ['code', 'name', 'price_gross', 'price_net', 'cost', 'stock', 'min_stock', 'tax_rate', 'active']

const SELECT = `
  SELECT p.*, (p.stock <= COALESCE(p.min_stock, @threshold)) AS low_stock
  FROM products p`

function validate(data, { partial }) {
  const isInt = (v) => Number.isInteger(v) && v >= 0
  if ((!partial || 'name' in data) && !String(data.name ?? '').trim()) throw new Error('El nombre es obligatorio')
  for (const f of ['price_gross', 'price_net', 'cost']) {
    if (f in data && !isInt(data[f])) throw new Error(`${f} debe ser un entero en centavos (>= 0)`)
  }
  if ('tax_rate' in data && !(data.tax_rate >= 0 && data.tax_rate <= 1)) throw new Error('tax_rate debe estar entre 0 y 1')
}

// Normaliza: recorta textos y convierte '' en NULL para el código (evita chocar con UNIQUE).
function normalize(data) {
  const out = {}
  for (const f of FIELDS) if (f in data) out[f] = data[f]
  if ('name' in out) out.name = out.name.trim()
  if ('code' in out) out.code = String(out.code ?? '').trim() || null
  if ('active' in out) out.active = out.active ? 1 : 0
  return out
}

export function createProductsRepo(db, { settings, audit }) {
  const threshold = () => settings.get('lowStockThreshold')

  const get = (id) => db.prepare(`${SELECT} WHERE p.id = @id`).get({ id, threshold: threshold() }) ?? null

  function translateError(err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE' && /products\.code/.test(err.message)) {
      throw new Error('Ya existe un producto con ese código')
    }
    throw err
  }

  return {
    get,

    // Búsqueda del escáner: coincidencia exacta por código, solo productos activos.
    findByCode(code) {
      return (
        db.prepare(`${SELECT} WHERE p.code = @code AND p.active = 1`).get({ code: String(code).trim(), threshold: threshold() }) ??
        null
      )
    },

    search({ text = '', lowStockOnly = false, includeInactive = false, limit = 200 } = {}) {
      const like = `%${text.trim()}%`
      return db
        .prepare(
          `${SELECT}
           WHERE (@includeInactive = 1 OR p.active = 1)
             AND (p.name LIKE @like OR p.code LIKE @like)
             AND (@lowStockOnly = 0 OR p.stock <= COALESCE(p.min_stock, @threshold))
           ORDER BY p.name LIMIT @limit`
        )
        .all({
          like,
          lowStockOnly: lowStockOnly ? 1 : 0,
          includeInactive: includeInactive ? 1 : 0,
          threshold: threshold(),
          limit
        })
    },

    lowStock() {
      return this.search({ lowStockOnly: true, limit: 1000 })
    },

    /**
     * Cifras de la existencia para la cabecera de Inventario. Se calculan en SQL sobre
     * todos los productos activos, no sobre los que la pantalla tenga cargados: la
     * búsqueda está limitada y el valor del almacén no puede depender de lo que se filtre.
     *
     * El stock negativo cuenta como cero para el dinero (se permite vender por debajo del
     * conteo): lo que no está en el anaquel no vale nada, aunque el número diga -3.
     */
    summary() {
      return db
        .prepare(
          `SELECT
             COUNT(*)                                          AS products,
             COALESCE(SUM(MAX(p.stock, 0)), 0)                 AS units,
             COALESCE(SUM(MAX(p.stock, 0) * p.cost), 0)        AS costValue,
             COALESCE(SUM(MAX(p.stock, 0) * p.price_gross), 0) AS saleValue,
             COALESCE(SUM(p.stock > COALESCE(p.min_stock, @threshold)), 0) AS healthy,
             COALESCE(SUM(p.stock > 0 AND p.stock <= COALESCE(p.min_stock, @threshold)), 0) AS low,
             COALESCE(SUM(p.stock <= 0), 0)                    AS out
           FROM products p WHERE p.active = 1`
        )
        .get({ threshold: threshold() })
    },

    create(data, { userId = null } = {}) {
      validate(data, { partial: false })
      const row = normalize(data)
      const cols = Object.keys(row)
      try {
        const { lastInsertRowid } = db
          .prepare(`INSERT INTO products (${cols.join(', ')}) VALUES (${cols.map((c) => '@' + c).join(', ')})`)
          .run(row)
        const created = get(Number(lastInsertRowid))
        audit.log({ entity: 'product', entityId: created.id, action: 'create', after: created, userId })
        return created
      } catch (err) {
        translateError(err)
      }
    },

    update(id, data, { userId = null } = {}) {
      validate(data, { partial: true })
      const before = get(id)
      if (!before) throw new Error('Producto no encontrado')
      const row = normalize(data)
      const cols = Object.keys(row)
      if (cols.length === 0) return before
      try {
        db.prepare(
          `UPDATE products SET ${cols.map((c) => `${c} = @${c}`).join(', ')}, updated_at = datetime('now', 'localtime') WHERE id = @id`
        ).run({ ...row, id })
      } catch (err) {
        translateError(err)
      }
      const after = get(id)
      audit.log({ entity: 'product', entityId: id, action: 'update', before, after, userId })
      return after
    },

    // Baja lógica: las ventas históricas conservan el producto.
    deactivate(id, { userId = null } = {}) {
      return this.update(id, { active: false }, { userId })
    },

    /**
     * Cambia el stock y deja registro en inventory_moves. `delta` con signo (+ entra, - sale).
     * Atómico: si algo falla no queda stock modificado sin movimiento.
     */
    adjustStock({ productId, delta, type = 'adjust', reason = null, userId = null }) {
      if (!MOVE_TYPES.includes(type)) throw new Error(`Tipo de movimiento inválido: ${type}`)
      if (!Number.isFinite(delta) || delta === 0) throw new Error('La cantidad debe ser distinta de cero')
      return db.transaction(() => {
        const before = get(productId)
        if (!before) throw new Error('Producto no encontrado')
        db.prepare('UPDATE products SET stock = stock + ?, updated_at = datetime(\'now\', \'localtime\') WHERE id = ?').run(delta, productId)
        db.prepare('INSERT INTO inventory_moves (product_id, type, qty, reason, user_id) VALUES (?, ?, ?, ?, ?)').run(
          productId, type, delta, reason, userId
        )
        const after = get(productId)
        audit.log({ entity: 'product', entityId: productId, action: 'stock', before: { stock: before.stock }, after: { stock: after.stock }, userId })
        return after
      })()
    },

    moves(productId, limit = 100) {
      return db.prepare('SELECT * FROM inventory_moves WHERE product_id = ? ORDER BY id DESC LIMIT ?').all(productId, limit)
    }
  }
}
