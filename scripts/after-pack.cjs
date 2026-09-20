// Recorte de tamaño tras empaquetar (§10).
//
// Electron incluye los archivos de idioma de Chromium para ~50 idiomas (unos 49 MB).
// La aplicación está en español, así que se conservan solo esos y el inglés de respaldo.
// `files` de electron-builder no alcanza aquí: estos archivos son de Electron, no de la app.
const { readdirSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')

const KEEP = new Set(['es.pak', 'es-419.pak', 'en-US.pak'])

exports.default = async function afterPack({ appOutDir }) {
  const localesDir = join(appOutDir, 'locales')
  let borrados = 0
  let bytes = 0

  try {
    for (const file of readdirSync(localesDir)) {
      if (!file.endsWith('.pak') || KEEP.has(file)) continue
      bytes += statSync(join(localesDir, file)).size
      rmSync(join(localesDir, file))
      borrados++
    }
  } catch (err) {
    // Sin locales que recortar (otra plataforma, o ya recortados): no es un error.
    if (err.code !== 'ENOENT') throw err
  }

  if (borrados > 0) {
    console.log(`  • idiomas recortados  quitados=${borrados} ahorro=${(bytes / 1024 / 1024).toFixed(0)}MB`)
  }
}
