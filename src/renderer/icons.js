// Íconos Lucide locales (SVG). Solo se empaquetan los que están en ./icons.
const files = import.meta.glob('./icons/*.svg', { query: '?raw', import: 'default', eager: true })

const svgs = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => [
    path.match(/([^/]+)\.svg$/)[1],
    raw
      .replace(/<!--[\s\S]*?-->/, '') // comentario de licencia
      // Solo se tocan los atributos de la etiqueta <svg> raíz: el tamaño lo da el CSS (.icon).
      // Hacerlo sobre todo el archivo borraría el width/height de los <rect> internos y
      // aplanaría íconos como credit-card.
      .replace(
        /<svg\b[^>]*>/,
        (tag) => tag.replace(/\s(width|height)="[^"]*"/g, '').replace(/\sclass="[^"]*"/, ' class="icon"')
      )
      .trim()
  ])
)

export function icon(name) {
  if (!svgs[name]) throw new Error(`Ícono no encontrado: ${name}`)
  return svgs[name]
}

// Rellena todos los [data-icon="nombre"] del documento.
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon)
  })
}
