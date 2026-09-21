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
  updates: {
    state: () => call('updates:state'),
    check: () => call('updates:check'),
    download: () => call('updates:download'),
    install: () => call('updates:install'),
    /**
     * Avisos que llegan del proceso principal (progreso de descarga, etc.).
     * Se pasa solo el dato, nunca el objeto `event` de Electron: expondría `sender`
     * y con él una vía para mandar mensajes internos desde la página.
     */
    onState: (callback) => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('updates:state', listener)
      return () => ipcRenderer.off('updates:state', listener)
    }
  },
  settings: {
    get: () => call('settings:get'),
    set: (patch) => call('settings:set', patch)
  },
  products: {
    search: (filters) => call('products:search', filters),
    findByCode: (code) => call('products:findByCode', code),
    create: (data) => call('products:create', data),
    update: (id, data) => call('products:update', id, data),
    deactivate: (id) => call('products:deactivate', id),
    lowStock: () => call('products:lowStock'),
    summary: () => call('products:summary'),
    adjustStock: (args) => call('products:adjustStock', args),
    moves: (id, limit) => call('products:moves', id, limit),
    history: (id) => call('products:history', id)
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
    previewSample: () => call('ticket:previewSample'),
    printSample: () => call('ticket:printSample'),
    print: (saleId) => call('ticket:print', saleId),
    savePdf: (saleId) => call('ticket:savePdf', saleId)
  },
  drawer: {
    open: () => call('drawer:open'),
    /** El cajón se abre solo al cobrar en efectivo; si falla, avisa por aquí. */
    onFail: (callback) => {
      const listener = (_event, mensaje) => callback(mensaje)
      ipcRenderer.on('drawer:failed', listener)
      return () => ipcRenderer.off('drawer:failed', listener)
    }
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
    printers: () => call('printers:list'),
    openFolder: () => call('data:openFolder'),
    chooseLogo: () => call('logo:choose')
  },
  auth: {
    state: () => call('auth:state'),
    users: () => call('auth:users'),
    login: (id, pin) => call('auth:login', id, pin),
    logout: () => call('auth:logout')
  },
  users: {
    list: () => call('users:list'),
    create: (args) => call('users:create', args),
    update: (id, args) => call('users:update', id, args),
    deactivate: (id) => call('users:deactivate', id)
  },
  returns: {
    items: (saleId) => call('returns:items', saleId),
    create: (args) => call('returns:create', args),
    list: (range) => call('returns:list', range)
  },
  audit: { list: (filters) => call('audit:list', filters) },
  backup: {
    list: () => call('backup:list'),
    create: () => call('backup:create'),
    saveAs: () => call('backup:saveAs'),
    inspect: () => call('backup:inspect'),
    restore: (source) => call('backup:restore', source)
  }
})
