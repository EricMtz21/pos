import { icon, hydrateIcons } from '../icons.js'

/**
 * Abre un <dialog> modal. Devuelve una promesa que resuelve con lo que se pase a `close(valor)`,
 * o null si se cancela (Esc / botón cerrar).
 *
 * @param title    encabezado
 * @param body     HTML del cuerpo
 * @param footer   HTML de los botones; usa data-close="valor" para cerrar devolviendo ese valor
 * @param onMount  ({ dialog, close }) tras insertarlo: aquí se enfoca y se enganchan listeners
 */
export function openModal({ title, body, footer = '', onMount } = {}) {
  const dialog = document.createElement('dialog')
  dialog.innerHTML = `
    <div class="modal-head">
      <h2></h2>
      <button class="btn ghost icon-only" type="button" data-close aria-label="Cerrar">${icon('x')}</button>
    </div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}`
  dialog.querySelector('h2').textContent = title
  document.body.append(dialog)
  hydrateIcons(dialog)

  return new Promise((resolve) => {
    let result = null
    const close = (value = null) => {
      result = value
      dialog.close()
    }

    dialog.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-close]')
      if (btn) close(btn.dataset.close || null)
    })
    // Esc dispara 'cancel' nativo: lo dejamos pasar, resuelve con null.
    dialog.addEventListener('close', () => {
      dialog.remove()
      resolve(result)
    })

    dialog.showModal()
    onMount?.({ dialog, close })
  })
}

/** Confirmación simple. Resuelve true/false. */
export async function confirmModal({ title, message, confirmLabel = 'Confirmar', danger = false }) {
  const res = await openModal({
    title,
    body: `<p></p>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn ${danger ? 'danger' : 'primary'}" type="button" data-close="ok">${confirmLabel}</button>`,
    onMount: ({ dialog }) => {
      dialog.querySelector('.modal-body p').textContent = message
      dialog.querySelector('[data-close="ok"]').focus()
    }
  })
  return res === 'ok'
}
