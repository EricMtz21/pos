import { SETTINGS_DEFAULTS } from '../../../shared/constants.js'
import { validateSettings } from '../../../shared/business/settings-validate.js'

// Cada clave de primer nivel se guarda como JSON. Lo no guardado cae a SETTINGS_DEFAULTS.
export function createSettingsRepo(db) {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  return {
    getAll() {
      const stored = Object.fromEntries(
        db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, JSON.parse(r.value)])
      )
      return { ...structuredClone(SETTINGS_DEFAULTS), ...stored }
    },

    get(key) {
      return this.getAll()[key]
    },

    // patch: { clave: valor, ... } — reemplaza el valor completo de cada clave.
    // Se valida aquí, no en la pantalla: el renderer no es la autoridad.
    set(patch) {
      const errors = validateSettings(patch)
      if (errors.length > 0) throw new Error(errors.join('. '))

      db.transaction(() => {
        for (const [key, value] of Object.entries(patch)) upsert.run(key, JSON.stringify(value))
      })()
      return this.getAll()
    }
  }
}
