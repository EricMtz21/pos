import { openModal } from '../components/modal.js'
import { toast } from '../components/toast.js'
import { formatMoney } from '../../shared/money.js'

/**
 * Vista previa del ticket tal como saldrá impreso, con opción a imprimir o guardar PDF.
 * `highlight` muestra el cambio en grande tras cobrar en efectivo.
 */
export async function showTicket(sale, { highlightChange = false } = {}) {
  const lines = await window.api.ticket.preview(sale.id)
  const change = sale.change_amount

  return openModal({
    title: `Ticket ${sale.folio}`,
    body: `
      ${
        highlightChange && change > 0
          ? `<div class="change-box" style="margin:0 0 16px"><span>Cambio para el cliente</span><strong>${formatMoney(change)}</strong></div>`
          : ''
      }
      <div class="ticket-paper"><pre id="ticket-text"></pre></div>`,
    footer: `<button class="btn" type="button" id="ticket-pdf">Guardar PDF</button>
             <button class="btn" type="button" id="ticket-print">Imprimir <kbd>Ctrl</kbd><kbd>P</kbd></button>
             <button class="btn primary" type="button" data-close>Listo <kbd>Esc</kbd></button>`,
    onMount: ({ dialog }) => {
      // textContent: el ticket es texto plano, nunca HTML.
      dialog.querySelector('#ticket-text').textContent = lines.join('\n')
      dialog.querySelector('.btn.primary').focus()

      const print = async () => {
        try {
          if (await window.api.ticket.print(sale.id)) toast('Ticket enviado a la impresora')
        } catch (err) {
          toast(err.message, 'error')
        }
      }

      dialog.querySelector('#ticket-print').addEventListener('click', print)
      dialog.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'p' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          print()
        }
      })

      dialog.querySelector('#ticket-pdf').addEventListener('click', async () => {
        try {
          const path = await window.api.ticket.savePdf(sale.id)
          if (path) toast(`PDF guardado: ${path}`)
        } catch (err) {
          toast(err.message, 'error')
        }
      })
    }
  })
}
