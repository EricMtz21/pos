import { contextBridge, ipcRenderer } from 'electron'

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw new Error(res.error)
  return res.data
}

// Única superficie que el renderer ve de Node/Electron.
contextBridge.exposeInMainWorld('api', {
  app: { info: () => call('app:info') },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch)
  },
  categories: { list: () => call('categories:list') },
  products: {
    search: (filters) => call('products:search', filters),
    findByCode: (code) => call('products:findByCode', code),
    create: (data) => call('products:create', data),
    update: (id, data) => call('products:update', id, data),
    deactivate: (id) => call('products:deactivate', id),
    lowStock: () => call('products:lowStock'),
    adjustStock: (args) => call('products:adjustStock', args)
  }
})
