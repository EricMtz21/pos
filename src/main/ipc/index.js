import { ipcMain } from 'electron'

// Todo handler responde { ok, data } | { ok: false, error } para que el renderer reciba
// mensajes limpios (Electron antepone texto técnico a los errores lanzados desde handle).
function handle(channel, fn) {
  ipcMain.handle(channel, (_event, ...args) => {
    try {
      return { ok: true, data: fn(...args) }
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, error: err.message }
    }
  })
}

export function registerIpc({ repos, appInfo }) {
  const { settings, categories, products } = repos

  handle('app:info', () => appInfo)

  handle('settings:get', () => settings.getAll())
  handle('settings:set', (patch) => settings.set(patch))

  handle('categories:list', () => categories.list())

  handle('products:search', (filters) => products.search(filters))
  handle('products:findByCode', (code) => products.findByCode(code))
  handle('products:create', (data) => products.create(data))
  handle('products:update', (id, data) => products.update(id, data))
  handle('products:deactivate', (id) => products.deactivate(id))
  handle('products:lowStock', () => products.lowStock())
  handle('products:adjustStock', (args) => products.adjustStock(args))
}
