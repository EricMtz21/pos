// Íconos Lucide locales (SVG). Solo se empaquetan los que están en ./icons.
const files = import.meta.glob('./icons/*.svg', { query: '?raw', import: 'default', eager: true })

const svgs = Object.fromEntries(
  Object.entries(files).map(([path, raw]) => [
    path.match(/([^/]+)\.svg$/)[1],
    // Quita el comentario de licencia y las dimensiones fijas; el tamaño lo da el CSS (.icon).
    raw.replace(/<!--[\s\S]*?-->/, '').replace(/\s(width|height)="\d+"/g, '').replace(/\sclass="[^"]*"/, ' class="icon"').trim()
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
