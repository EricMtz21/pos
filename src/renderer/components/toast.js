import { icon } from '../icons.js'

export function toast(message, type = 'info') {
  const el = document.createElement('div')
  el.className = `toast ${type}`
  el.innerHTML = `${icon(type === 'error' ? 'triangle-alert' : 'circle-check')}<span></span>`
  el.querySelector('span').textContent = message // textContent: nunca insertar mensajes como HTML
  document.getElementById('toasts').append(el)
  setTimeout(() => el.remove(), 3500)
}
