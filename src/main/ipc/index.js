import { ipcMain, BrowserWindow, dialog } from 'electron'
import { renderTicket } from '../../shared/business/ticket.js'
import { printTicket, saveTicketPdf } from '../ticket-print.js'
import { writeReport, reportFileName } from '../export-excel.js'

// Todo handler responde { ok, data } | { ok: false, error } para que el renderer reciba
// mensajes limpios (Electron antepone texto técnico a los errores lanzados desde handle).
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, data: await fn(...args, event) }
    } catch (err) {
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, error: err.message }
    }
  })
}

export function registerIpc({ repos, appInfo, backup }) {
  const { settings, categories, products, sales, reports, cashCuts } = repos

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
  handle('products:create', (data) => products.create(data))
  handle('products:update', (id, data) => products.update(id, data))
  handle('products:deactivate', (id) => products.deactivate(id))
  handle('products:lowStock', () => products.lowStock())
  handle('products:adjustStock', (args) => products.adjustStock(args))

  handle('sales:create', (payload) => sales.create(payload))
  handle('sales:get', (id) => sales.get(id))
  handle('sales:last', () => sales.last())
  handle('sales:list', (filters) => sales.list(filters))
  handle('sales:cancel', (id, options) => sales.cancel(id, options))
  handle('sales:previewCommission', (args) => sales.previewCommission(args))

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
    cuts: cashCuts.list()
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

  handle('cashCuts:create', (args) => {
    const cut = cashCuts.create(args)
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
