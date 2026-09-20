import { openModal } from '../components/modal.js'
import { listShortcuts, kbd } from '../shortcuts/index.js'

let open = false

/** Panel de ayuda (F1): lista los atajos activos en este momento. */
export function showHelp() {
  if (open) return // F1 de nuevo no apila paneles
  open = true

  const rows = listShortcuts()
    .filter((s) => s.description)
    .map((s) => `<div class="shortcut-row"><span>${s.description}</span>${kbd(s.combo)}</div>`)
    .join('')

  openModal({
    title: 'Atajos de teclado',
    body: `<div class="shortcut-list">${rows}</div>`,
    footer: '<button class="btn primary" type="button" data-close>Cerrar</button>',
    // Sin esto el foco cae en la «X» del encabezado.
    onMount: ({ dialog }) => dialog.querySelector('.modal-foot .btn').focus()
  }).then(() => {
    open = false
  })
}
