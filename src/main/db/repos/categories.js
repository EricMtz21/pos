export function createCategoriesRepo(db) {
  return {
    list() {
      return db.prepare('SELECT id, name FROM categories ORDER BY name').all()
    },

    create(name) {
      const clean = String(name ?? '').trim()
      if (!clean) throw new Error('El nombre de la categoría es obligatorio')
      const { lastInsertRowid } = db.prepare('INSERT INTO categories (name) VALUES (?)').run(clean)
      return { id: Number(lastInsertRowid), name: clean }
    },

    rename(id, name) {
      const clean = String(name ?? '').trim()
      if (!clean) throw new Error('El nombre de la categoría es obligatorio')
      db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(clean, id)
    },

    // Los productos de la categoría quedan sin categoría (ON DELETE SET NULL).
    remove(id) {
      db.prepare('DELETE FROM categories WHERE id = ?').run(id)
    }
  }
}
