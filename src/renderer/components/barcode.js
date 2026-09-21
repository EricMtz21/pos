// Código de barras dibujado, no real: no codifica ningún número. Es un adorno honesto
// para las pantallas vacías, y dice de qué va este programa mejor que una línea de texto.
// Índices pares = barra, impares = espacio, como un código de verdad.
const PATRON = [3, 1, 2, 1, 1, 2, 3, 1, 1, 3, 2, 1, 1, 2, 2, 3, 1, 1, 3, 2, 1, 1, 2, 1, 3, 2, 1, 3, 1, 1, 2, 2]

export function barcodeSvg(alto = 30) {
  const unidad = 2.4
  let x = 0
  const barras = PATRON.map((ancho, i) => {
    const rect = i % 2 === 0 ? `<rect x="${x.toFixed(1)}" y="0" width="${(ancho * unidad).toFixed(1)}" height="${alto}" rx="0.5"/>` : ''
    x += ancho * unidad
    return rect
  }).join('')
  return `<svg class="barcode" viewBox="0 0 ${x.toFixed(1)} ${alto}" preserveAspectRatio="none" aria-hidden="true">${barras}</svg>`
}
