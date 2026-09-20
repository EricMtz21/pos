import { icon } from '../icons.js'

const timers = new WeakMap()

export function toast(message, type = 'info') {
  const container = document.getElementById('toasts')

  // Un mensaje repetido reinicia el aviso existente en vez de apilar otro igual:
  // guardar varios campos seguidos no debe tapar media pantalla.
  const existing = [...container.children].find(
    (el) => el.dataset.type === type && el.querySelector('span').textContent === message
  )
  const el = existing ?? document.createElement('div')

  if (!existing) {
    el.className = `toast ${type}`
    el.dataset.type = type
    el.innerHTML = `${icon(type === 'error' ? 'triangle-alert' : 'circle-check')}<span></span>`
    el.querySelector('span').textContent = message // textContent: nunca insertar mensajes como HTML
    container.append(el)
  }

  clearTimeout(timers.get(el))
  timers.set(el, setTimeout(() => el.remove(), 3500))
}
