// Infraestructura central de atajos. Los combos se escriben como 'F2', 'Ctrl+D', 'Ctrl+,'.
const bindings = new Map() // combo -> [{ handler, description }]

const KEY_ALIASES = { Escape: 'Esc', Delete: 'Supr', ' ': 'Space' }

export function comboFromEvent(e) {
  let key = KEY_ALIASES[e.key] ?? e.key
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) return null
  if (key.length === 1) key = key.toUpperCase()
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', key]
    .filter(Boolean)
    .join('+')
}

/** Registra un atajo. Devuelve la función para quitarlo (úsala al salir de una vista). */
export function register(combo, handler, description = '') {
  const entry = { handler, description }
  bindings.set(combo, [...(bindings.get(combo) ?? []), entry])
  return () => bindings.set(combo, bindings.get(combo).filter((b) => b !== entry))
}

/** Lista de atajos activos, para el panel de ayuda (F1). */
export function listShortcuts() {
  return [...bindings].flatMap(([combo, list]) => list.map((b) => ({ combo, description: b.description })))
}

/** HTML del badge <kbd> de un combo: 'Ctrl+D' → <kbd>Ctrl</kbd><kbd>D</kbd> */
export function kbd(combo) {
  const keys = combo === 'Ctrl+,' ? ['Ctrl', ','] : combo.split('+')
  return `<span class="kbd-group">${keys.map((k) => `<kbd>${k}</kbd>`).join('')}</span>`
}

const isEditable = (el) =>
  el instanceof HTMLElement &&
  (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))

// Un combo sin modificador ni tecla de función (ej. '+', 'Supr') es texto que el usuario
// puede estar escribiendo: no se dispara mientras el foco está en un campo.
const isTypingKey = (combo) => !combo.includes('+') && !/^F\d+$/.test(combo)

export function initShortcuts() {
  window.addEventListener(
    'keydown',
    (e) => {
      // Con un modal abierto manda el modal: Esc lo cierra de forma nativa.
      if (document.querySelector('dialog[open]')) return

      const combo = comboFromEvent(e)
      const list = combo && bindings.get(combo)
      if (!list?.length) return
      if (isEditable(e.target) && isTypingKey(combo)) return

      e.preventDefault()
      // El último registrado (la vista activa) tiene prioridad sobre los globales.
      list.at(-1).handler(e)
    },
    true
  )
}
