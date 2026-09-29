// Rehace las capturas del README sobre la tienda de ejemplo.
// Uso: npm run capturas   (genera la tienda con `demo.js datos` y luego corre esto)
//
// No es una prueba: no afirma nada, solo recorre las pantallas y las guarda en docs/.
// Usa `.demo-data/` y nunca los datos reales.
import electron from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bootApp, setup, sleep, fail } from './smoke-lib.js'

const raiz = join(import.meta.dirname, '..')
const docs = join(raiz, 'docs')

// Lanzada como script, Electron no encuentra el package.json y `app.getVersion()` devuelve
// su propia versión: el pie de la barra lateral decía «Versión 44.4.3».
const { version } = JSON.parse(readFileSync(join(raiz, 'package.json'), 'utf8'))
electron.app.setVersion(version)

process.env.POS_DATA_DIR = join(raiz, '.demo-data')
process.env.POS_SEED = '0' // la tienda ya viene llena: la semilla de pruebas se mezclaría con ella

await bootApp(import.meta.dirname)

electron.app.whenReady().then(async () => {
  const { win, run, waitFor, key } = await setup({ prefix: 'capturas' })

  const guardar = async (nombre) => {
    await sleep(400) // que termine la animación de entrada
    writeFileSync(join(docs, `${nombre}.png`), (await win.webContents.capturePage()).toPNG())
    console.log(`  docs/${nombre}.png`)
  }

  // ── Ventas: un carrito como los de la tienda, una figura y sus accesorios ──
  for (const code of ['889698722193', '7502260410015', '9786075295473']) {
    await run(`(() => {
      const s = document.querySelector('#scan')
      s.focus(); s.value = ${JSON.stringify(code)}
      s.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })()`)
  }
  await waitFor(`document.querySelectorAll('.cart-row').length === 3`, 'tres líneas en el carrito')
  await guardar('ventas')

  await key('i', { ctrlKey: true })
  await waitFor(`document.querySelectorAll('#inv-rows tr').length > 10`, 'Ctrl+I con el catálogo')
  await guardar('inventario')

  // El rango por omisión es hoy; el mes entero llena los gráficos.
  await key('r', { ctrlKey: true })
  await waitFor(`document.querySelector('[data-preset="mes"]')`, 'Ctrl+R abre Reportes')
  await run(`document.querySelector('[data-preset="mes"]').click()`)
  await waitFor(`document.querySelector('#r-from').value.endsWith('-01')`, 'rango de este mes')
  // Las tarjetas de hoy ya estaban puestas: esperarlas no dice que llegaron las del mes.
  await sleep(1000)
  await guardar('reportes')

  await key(',', { ctrlKey: true })
  await waitFor(`document.querySelector('#s-business')`, 'Ctrl+, abre Ajustes')
  await guardar('ajustes')

  electron.app.exit(0)
}).catch(fail)
