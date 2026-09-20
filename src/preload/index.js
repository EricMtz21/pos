import { contextBridge, ipcRenderer } from 'electron'

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args)
  if (!res.ok) throw new Error(res.error)
  return res.data
}

// Única superficie que el renderer ve de Node/Electron.
contextBridge.exposeInMainWorld('api', {
  app: {
    info: () => call('app:info'),
    relaunch: () => call('app:relaunch')
  },
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
  },
  sales: {
    create: (payload) => call('sales:create', payload),
    get: (id) => call('sales:get', id),
    last: () => call('sales:last'),
    list: (filters) => call('sales:list', filters),
    cancel: (id, options) => call('sales:cancel', id, options),
    previewCommission: (args) => call('sales:previewCommission', args)
  },
  ticket: {
    preview: (saleId) => call('ticket:preview', saleId),
    print: (saleId) => call('ticket:print', saleId),
    savePdf: (saleId) => call('ticket:savePdf', saleId)
  },
  reports: {
    get: (range) => call('reports:get', range),
    export: (range) => call('reports:export', range)
  },
  cashCuts: {
    preview: (args) => call('cashCuts:preview', args),
    create: (args) => call('cashCuts:create', args),
    list: (limit) => call('cashCuts:list', limit)
  },
  data: {
    info: () => call('data:info'),
    openFolder: () => call('data:openFolder'),
    chooseLogo: () => call('logo:choose')
  },
  backup: {
    list: () => call('backup:list'),
    create: () => call('backup:create'),
    saveAs: () => call('backup:saveAs'),
    inspect: () => call('backup:inspect'),
    restore: (source) => call('backup:restore', source)
  }
})
