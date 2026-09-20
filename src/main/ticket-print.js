import { BrowserWindow, app, dialog } from 'electron'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { renderTicket, WIDTHS } from '../shared/business/ticket.js'

const MM_PER_INCH = 25.4
const LINE_HEIGHT_IN = 0.155 // 11px a 72dpi, con interlineado

/** El ticket es texto de ancho fijo: basta una <pre> monoespaciada del ancho del papel. */
function ticketHtml(lines, widthMm) {
  const escaped = lines
    .join('\n')
    .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
  // El tamaño de fuente se ajusta para que quepan exactamente los caracteres del papel.
  const chars = WIDTHS[widthMm] ?? WIDTHS[58]
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 0 }
    body { margin: 0; padding: 3mm; background: #fff }
    pre {
      margin: 0; color: #000;
      font: ${((widthMm - 6) / chars) * 1.85}mm/1.35 'Consolas', 'Courier New', monospace;
      white-space: pre;
    }
  </style></head><body><pre>${escaped}</pre></body></html>`
}

/** Ventana oculta con el ticket cargado. El llamador la destruye. */
async function renderInWindow(html) {
  const file = join(app.getPath('temp'), `pos-ticket-${Date.now()}.html`)
  await writeFile(file, html, 'utf8')
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } })
  try {
    await win.loadFile(file)
    return win
  } catch (err) {
    win.destroy()
    throw err
  } finally {
    await unlink(file).catch(() => {})
  }
}

/**
 * Imprime el ticket abriendo el diálogo del sistema, así funciona con cualquier impresora
 * instalada (incluida una térmica) sin configurarla en la app.
 */
export async function printTicket(sale, { business, width }) {
  const win = await renderInWindow(ticketHtml(renderTicket(sale, { business, width }), width))
  try {
    const { failureReason } = await win.webContents.print({ silent: false, margins: { marginType: 'none' } })
    if (failureReason) throw new Error(failureReason)
    return true
  } catch (err) {
    // Cancelar el diálogo de impresión no es un error que valga la pena mostrar.
    if (/cancel/i.test(err.message)) return false
    throw err
  } finally {
    win.destroy()
  }
}

/** Guarda el ticket como PDF del tamaño exacto del papel. */
export async function saveTicketPdf(sale, { business, width }, parent) {
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Guardar ticket',
    defaultPath: `ticket-${sale.folio}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return null

  const lines = renderTicket(sale, { business, width })
  const win = await renderInWindow(ticketHtml(lines, width))
  try {
    const pdf = await win.webContents.printToPDF({
      pageSize: {
        width: width / MM_PER_INCH,
        // El papel térmico es un rollo: la altura crece con el contenido.
        height: lines.length * LINE_HEIGHT_IN + 0.5
      },
      printBackground: true,
      margins: { marginType: 'none' }
    })
    await writeFile(filePath, pdf)
    return filePath
  } finally {
    win.destroy()
  }
}
