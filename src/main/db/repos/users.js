import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'

// El PIN se guarda como scrypt con sal, nunca en claro ni como hash simple.
// Formato: scrypt$<sal hex>$<derivado hex>
const KEY_LENGTH = 32

export function hashPin(pin) {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(String(pin), salt, KEY_LENGTH).toString('hex')}`
}

export function verifyPin(pin, stored) {
  const [scheme, saltHex, hashHex] = String(stored ?? '').split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(String(pin), Buffer.from(saltHex, 'hex'), expected.length)
  // timingSafeEqual exige la misma longitud; si no coincide, el PIN tampoco.
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

const PIN_PATTERN = /^\d{4,8}$/

export function createUsersRepo(db, { audit }) {
  const publicFields = 'id, name, role, active'

  const get = (id) => db.prepare(`SELECT ${publicFields} FROM users WHERE id = ?`).get(id) ?? null

  function validate({ name, role, pin }, { requirePin }) {
    if (!String(name ?? '').trim()) throw new Error('El nombre es obligatorio')
    if (!['admin', 'cashier'].includes(role)) throw new Error(`Rol inválido: ${role}`)
    if ((requirePin || pin !== undefined) && !PIN_PATTERN.test(String(pin ?? ''))) {
      throw new Error('El PIN debe tener entre 4 y 8 dígitos')
    }
  }

  return {
    get,

    list({ includeInactive = false } = {}) {
      return db
        .prepare(`SELECT ${publicFields} FROM users WHERE (@all = 1 OR active = 1) ORDER BY role, name`)
        .all({ all: includeInactive ? 1 : 0 })
    },

    /** Con cero usuarios la app no pide PIN: los roles son opcionales hasta que se crea el primero. */
    isAuthRequired() {
      return db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n > 0
    },

    create({ name, role = 'cashier', pin, userId = null }) {
      validate({ name, role, pin }, { requirePin: true })
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (name, role, pin_hash) VALUES (?, ?, ?)')
        .run(String(name).trim(), role, hashPin(pin))
      const created = get(Number(lastInsertRowid))
      audit.log({ entity: 'user', entityId: created.id, action: 'create', after: created, userId })
      return created
    },

    update(id, { name, role, pin, active }, { userId = null } = {}) {
      const before = get(id)
      if (!before) throw new Error('Usuario no encontrado')
      validate({ name: name ?? before.name, role: role ?? before.role, ...(pin !== undefined && { pin }) }, { requirePin: false })

      // El último administrador activo no puede degradarse ni desactivarse: dejaría
      // la aplicación sin nadie capaz de volver a entrar a los ajustes.
      const dejaDeSerAdmin = before.role === 'admin' && ((role && role !== 'admin') || active === false)
      if (dejaDeSerAdmin) {
        const { n } = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?").get(id)
        if (n === 0) throw new Error('Debe quedar al menos un administrador activo')
      }

      db.prepare(
        `UPDATE users SET name = COALESCE(@name, name), role = COALESCE(@role, role),
                          active = COALESCE(@active, active),
                          pin_hash = COALESCE(@pinHash, pin_hash)
         WHERE id = @id`
      ).run({
        id,
        name: name ? String(name).trim() : null,
        role: role ?? null,
        active: active === undefined ? null : active ? 1 : 0,
        pinHash: pin === undefined ? null : hashPin(pin)
      })

      const after = get(id)
      audit.log({ entity: 'user', entityId: id, action: 'update', before, after, userId })
      return after
    },

    /** Baja lógica: las ventas históricas conservan a quién las cobró. */
    deactivate(id, { userId = null } = {}) {
      return this.update(id, { active: false }, { userId })
    },

    /** Devuelve el usuario si el PIN corresponde, o null. */
    authenticate(id, pin) {
      const row = db.prepare('SELECT id, pin_hash, active FROM users WHERE id = ?').get(id)
      if (!row || !row.active || !verifyPin(pin, row.pin_hash)) return null
      return get(id)
    }
  }
}
