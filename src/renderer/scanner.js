/**
 * Captura global del lector de código de barras.
 *
 * El lector USB se comporta como un teclado: teclea el código muy rápido y termina con
 * Enter. Antes esto solo funcionaba si el cursor estaba en la caja de búsqueda; si el
 * cajero había tocado cualquier botón, escanear no hacía nada y no avisaba de por qué.
 *
 * Se distingue del tecleo humano por la velocidad: un lector manda una tecla cada 5-20 ms,
 * muy por debajo de lo que alcanza una persona. Así, escribir «café» y pulsar Enter sigue
 * siendo escritura normal, y un escaneo se reconoce esté donde esté el foco.
 */
const PAUSA_MAXIMA_MS = 60 // más lento que esto entre teclas, es una persona escribiendo
const LARGO_MINIMO = 4

let handler = null
let buffer = ''
let ultimaTecla = 0

/** Registra qué hace un escaneo en la vista activa. Devuelve la función para soltarlo. */
export function onScan(fn) {
  handler = fn
  return () => {
    if (handler === fn) handler = null
  }
}

export function initScanner() {
  window.addEventListener(
    'keydown',
    (e) => {
      // Con un modal o la pantalla de bloqueo delante, el escaneo no tiene destino.
      if (document.querySelector('dialog[open]') || document.querySelector('.login')) {
        buffer = ''
        return
      }

      const ahora = performance.now()
      if (ahora - ultimaTecla > PAUSA_MAXIMA_MS) buffer = ''
      ultimaTecla = ahora

      if (e.key.length === 1) {
        buffer += e.key
        return
      }

      if (e.key === 'Enter' && buffer.length >= LARGO_MINIMO && handler) {
        const code = buffer
        buffer = ''
        // Se corta aquí: sin esto el Enter llegaría además al campo que tenga el foco
        // y la vista trataría el mismo código dos veces.
        e.preventDefault()
        e.stopPropagation()
        handler(code)
      }
    },
    true
  )
}
