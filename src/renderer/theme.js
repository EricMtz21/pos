const media = window.matchMedia('(prefers-color-scheme: dark)')
let preference = 'system' // light | dark | system

const resolved = () => (preference === 'system' ? (media.matches ? 'dark' : 'light') : preference)

function paint() {
  document.documentElement.dataset.theme = resolved()
  window.dispatchEvent(new CustomEvent('themechange', { detail: resolved() }))
}

// Texto oscuro o claro sobre el color de acento, según su luminosidad.
function contrastOn(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? '#12160B' : '#FFFFFF'
}

export function applyAccent(hex) {
  const root = document.documentElement.style
  root.setProperty('--accent', hex)
  root.setProperty('--accent-contrast', contrastOn(hex))
}

export function initTheme(theme, accent) {
  preference = theme
  applyAccent(accent)
  paint()
  media.addEventListener('change', () => preference === 'system' && paint())
}

export const currentTheme = resolved

/** Alterna claro/oscuro y lo guarda en ajustes. */
export async function toggleTheme() {
  preference = resolved() === 'dark' ? 'light' : 'dark'
  paint()
  await window.api.settings.set({ theme: preference })
}
