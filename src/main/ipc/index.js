import { ipcMain, BrowserWindow, app, dialog, shell } from 'electron'
import { copyFileSync } from 'node:fs'
import { renderTicket } from '../../shared/business/ticket.js'
import { printTicket, saveTicketPdf } from '../ticket-print.js'
import { writeReport, reportFileName } from '../export-excel.js'
import { listBackups, restoreDatabase, inspectDatabaseFile, importLogo } from '../data-files.js'
import { can, deniedForCashier } from '../../shared/business/permissions.js'

// Sesión actual. Vive en el proceso principal: el renderer no puede alterarla,
// y es aquí donde se comprueban los permisos antes de ejecutar nada.
let session = null

export function registerIpc({ repos, appInfo, backup, data }) {
  const { settings, categories, products, sales, returns, reports, cashCuts, users } = repos
  const parentOf = (event) => BrowserWindow.fromWebContents(event.sender)

  // Sin usuarios dados de alta no hay sesión ni restricciones (ver permissions.js).
  const currentRole = () => (users.isAuthRequired() ? (session?.role ?? 'nobody') : null)
  const currentUserId = () => session?.id ?? null

  /**
   * Todo handler responde { ok, data } | { ok: false, error } para que el renderer reciba
   * mensajes limpios (Electron antepone texto técnico a los errores lanzados desde handle).
   * Antes de ejecutar comprueba el permiso del canal: la interfaz esconde los botones,
   * pero quien decide es esto.
   */
  function handle(channel, fn, { open = false } = {}) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        if (!open && !can(currentRole(), channel)) {
          throw new Error('Tu usuario no tiene permiso para esta acción')
        }
        return { ok: true, data: await fn(...args, event) }
      } catch (err) {
        console.error(`[ipc] ${channel}:`, err)
        return { ok: false, error: err.message }
      }
    })
  }

  // ── Sesión ──
  const sessionState = () => ({
    required: users.isAuthRequired(),
    user: session,
    role: currentRole(),
    denied: deniedForCashier()
  })

  handle('auth:state', () => sessionState(), { open: true })
  handle('auth:users', () => users.list(), { open: true })

  handle(
    'auth:login',
    (id, pin) => {
      const user = users.authenticate(id, pin)
      if (!user) throw new Error('PIN incorrecto')
      session = user
      repos.audit.log({ entity: 'user', entityId: user.id, action: 'login', userId: user.id })
      return sessionState()
    },
    { open: true }
  )

  handle(
    'auth:logout',
    () => {
      session = null
      return sessionState()
    },
    { open: true }
  )

  handle('users:list', () => users.list({ includeInactive: true }))

  handle('users:create', (args) => {
    const eraElPrimero = !users.isAuthRequired()
    const created = users.create({ ...args, userId: currentUserId() })
    // Al crear el primer usuario la app empieza a exigir sesión. Quien lo acaba de dar
    // de alta está frente al teclado: se le abre sesión para que no quede fuera a
    // media configuración, sin poder siquiera crear al cajero.
    if (eraElPrimero) session = created
    return created
  })

  handle('users:update', (id, args) => users.update(id, args, { userId: currentUserId() }))
  handle('users:deactivate', (id) => users.deactivate(id, { userId: currentUserId() }))

  // Opciones de ticket vigentes, para imprimir y para la vista previa.
  const ticketOptions = () => {
    const all = settings.getAll()
    return { business: all.business, width: all.ticket.width }
  }

  handle('app:info', () => appInfo)

  handle('settings:get', () => settings.getAll())
  handle('settings:set', (patch) => settings.set(patch))

  handle('categories:list', () => categories.list())

  handle('products:search', (filters) => products.search(filters))
  handle('products:findByCode', (code) => products.findByCode(code))
  handle('products:create', (data) => products.create(data, { userId: currentUserId() }))
  handle('products:update', (id, data) => products.update(id, data, { userId: currentUserId() }))
  handle('products:deactivate', (id) => products.deactivate(id, { userId: currentUserId() }))
  handle('products:lowStock', () => products.lowStock())
  handle('products:adjustStock', (args) => products.adjustStock({ ...args, userId: currentUserId() }))
  handle('products:moves', (id, limit) => products.moves(id, limit))
  handle('products:history', (id) => repos.audit.list({ entity: 'product', entityId: id, limit: 50 }))

  handle('sales:create', (payload) => sales.create({ ...payload, userId: currentUserId() }))
  handle('sales:get', (id) => sales.get(id))
  handle('sales:last', () => sales.last())
  handle('sales:list', (filters) => sales.list(filters))
  handle('sales:cancel', (id, options) => sales.cancel(id, { ...options, userId: currentUserId() }))
  handle('sales:previewCommission', (args) => sales.previewCommission(args))

  handle('returns:items', (saleId) => returns.returnableItems(saleId))
  handle('returns:create', (args) => returns.create({ ...args, userId: currentUserId() }))
  handle('returns:list', (range) => returns.list(range))

  handle('audit:list', (filters) => repos.audit.list(filters))

  handle('ticket:preview', (saleId) => {
    const sale = sales.get(saleId)
    if (!sale) throw new Error('Venta no encontrada')
    return renderTicket(sale, ticketOptions())
  })

  handle('ticket:print', (saleId) => {
    const sale = sales.get(saleId)
    if (!sale) throw new Error('Venta no encontrada')
    return printTicket(sale, ticketOptions())
  })

  handle('ticket:savePdf', (saleId, event) => {
    const sale = sales.get(saleId)
    if (!sale) throw new Error('Venta no encontrada')
    return saveTicketPdf(sale, ticketOptions(), BrowserWindow.fromWebContents(event.sender))
  })

  // Todo lo que pinta la pantalla de reportes, en una sola llamada.
  const reportData = (range) => ({
    ...range,
    summary: reports.summary(range),
    byDay: reports.byDay(range),
    byMethod: reports.byMethod(range),
    topProducts: reports.topProducts(range),
    sales: reports.sales(range),
    cuts: cashCuts.list(),
    returns: returns.list(range)
  })

  handle('reports:get', (range) => reportData(range))

  handle('reports:export', async (range, event) => {
    const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Exportar reporte',
      defaultPath: reportFileName(range),
      filters: [{ name: 'Excel', extensions: ['xlsx'] }]
    })
    if (canceled || !filePath) return null
    return writeReport({ ...reportData(range), business: settings.get('business') }, filePath)
  })

  handle('cashCuts:preview', (args) => cashCuts.preview(args))
  handle('cashCuts:list', (limit) => cashCuts.list(limit))

  // ── Datos: respaldo, restauración y logo ──
  handle('data:info', () => ({ ...data.paths, printers: [] }))

  handle('backup:list', () => listBackups(data.paths.backupDir))

  handle('backup:create', () => backup('manual'))

  /** Guarda una copia donde el usuario elija, para llevársela a otra computadora. */
  handle('backup:saveAs', async (event) => {
    const { canceled, filePath } = await dialog.showSaveDialog(parentOf(event), {
      title: 'Guardar copia de la base de datos',
      defaultPath: `pos-${new Date().toLocaleDateString('en-CA')}.sqlite`,
      filters: [{ name: 'Base de datos', extensions: ['sqlite'] }]
    })
    if (canceled || !filePath) return null
    copyFileSync(backup('export'), filePath) // copia consistente, no el archivo en uso
    return filePath
  })

  /** Solo inspecciona el archivo: la pantalla pide confirmación antes de restaurar. */
  handle('backup:inspect', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(event), {
      title: 'Elegir respaldo',
      defaultPath: data.paths.backupDir,
      properties: ['openFile'],
      filters: [{ name: 'Base de datos', extensions: ['sqlite', 'db'] }]
    })
    if (canceled || filePaths.length === 0) return null
    return { path: filePaths[0], ...inspectDatabaseFile(filePaths[0]) }
  })

  // Restaurar y reiniciar van separados: así la restauración se puede verificar sin
  // que el proceso se muera a media comprobación, y cada handler hace una sola cosa.
  handle('backup:restore', (source) => data.restore(source))

  handle('app:relaunch', () => {
    app.relaunch()
    setTimeout(() => app.exit(0), 300)
    return true
  })

  handle('data:openFolder', () => shell.openPath(data.paths.dataDir))

  handle('logo:choose', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parentOf(event), {
      title: 'Elegir logo para el ticket',
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (canceled || filePaths.length === 0) return null
    const logo = importLogo(filePaths[0], data.paths.dataDir)
    settings.set({ business: { ...settings.get('business'), logo } })
    return logo
  })

  handle('cashCuts:create', (args) => {
    const cut = cashCuts.create({ ...args, userId: currentUserId() })
    // §6: respaldo automático de la base en cada corte de caja.
    try {
      backup?.('corte')
    } catch (err) {
      // El corte ya quedó registrado; un respaldo fallido no debe deshacerlo.
      console.error('[ipc] respaldo tras el corte falló:', err)
    }
    return cut
  })
}
