// Utilidades compartidas por las pruebas de humo.
// Nota: Electron debe arrancar SIN `ELECTRON_RUN_AS_NODE`, o corre como Node puro.
import electron from 'electron'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { app, BrowserWindow } = electron

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * Carga el bundle de main (out/) para arrancar la app real.
 *
 * Cada prueba tiene su carpeta de datos y la estrena vacía, por dos razones: afirman
 * cuentas exactas (8 productos del seed) y no pueden heredar lo de la corrida anterior, y
 * la app solo admite una instancia por carpeta — dos pruebas distintas seguidas se
 * pisarían mientras la anterior termina de cerrarse, y la segunda se cerraría sola sin
 * decir por qué.
 */
export const bootApp = (dir) => {
  if (!process.env.POS_DATA_DIR) {
    // Una carpeta fija por prueba, que se vacía al arrancar. Con una carpeta nueva en cada
    // corrida (con la fecha en el nombre) el antivirus revisaba un árbol entero recién
    // creado justo mientras la app arrancaba, y saltaban esperas agotadas en pasos al azar.
    const nombre = basename(process.argv[1] ?? 'smoke', '.js')
    const carpeta = join(tmpdir(), 'pos-smoke', nombre)
    try {
      rmSync(carpeta, { recursive: true, force: true })
    } catch {
      // En Windows, si la corrida anterior todavía se está cerrando, el borrado falla con
      // EPERM. No es un fallo de la prueba: se sigue con lo que haya.
    }
    mkdirSync(carpeta, { recursive: true })
    process.env.POS_DATA_DIR = carpeta
  }
  process.env.POS_SEED ??= '1'
  return import(pathToFileURL(join(dir, '../out/main/index.cjs')).href)
}

/**
 * Prepara el contexto de una prueba: ventana lista, helpers de DOM y capturas.
 * `waitFor` espera a que se cumpla una condición en vez de dormir un tiempo fijo:
 * la UI depende de debounce + IPC y los sleeps fijos vuelven las pruebas inestables.
 */
export async function setup({ prefix = 'smoke' } = {}) {
  const outDir = process.env.SMOKE_OUT ?? process.cwd()
  mkdirSync(outDir, { recursive: true })

  await sleep(2500)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('No se abrió ninguna ventana')

  const problems = []

  // Un fallo al evaluar en la pantalla decía solo «Script failed to execute», sin pista de
  // qué expresión reventó: con veinte llamadas por prueba eso no sirve para nada. Aquí se
  // añade la expresión al mensaje, que es lo primero que uno quiere ver.
  const run = async (js) => {
    try {
      return await win.webContents.executeJavaScript(js)
    } catch (err) {
      const corta = js.trim().replace(/\s+/g, ' ').slice(0, 140)
      throw new Error(`falló al evaluar «${corta}» · ${err.message}`)
    }
  }

  // `Promise.resolve(...)` admite tanto condiciones síncronas como llamadas a window.api:
  // sin él, `Boolean(unaPromesa)` sería siempre cierto y la espera terminaría de inmediato.
  // 10 s no es tiempo de respuesta esperado, es margen: cada corrida estrena carpeta de
  // datos y el antivirus la revisa mientras la app arranca. Con 5 s fallaba una de cada
  // pocas corridas seguidas, y siempre en un paso distinto: ruido, no un defecto.
  const waitFor = async (js, label, timeout = 10000) => {
    for (let waited = 0; waited < timeout; waited += 50) {
      if (await run(`Promise.resolve(${js}).then(Boolean)`)) return true
      await sleep(50)
    }
    // Al agotarse, se informa qué había en pantalla: un timeout a secas no dice nada.
    const contexto = await run(`({
      toast: [...document.querySelectorAll('.toast')].at(-1)?.textContent.trim() ?? '(ninguno)',
      dialog: document.querySelector('dialog[open] h2')?.textContent ?? '(ninguno)'
    })`).catch(() => ({ toast: '?', dialog: '?' }))
    const detalle = `agotó la espera: ${label} · último aviso: "${contexto.toast}" · modal abierto: ${contexto.dialog}`
    problems.push(detalle)
    // Y se corta aquí. Antes seguía adelante, y lo que se veía en la salida era el error
    // de dos pasos después —un `null.click()`— en vez de la espera que de verdad falló.
    throw new Error(detalle)
  }

  return {
    win,
    run,
    problems,
    waitFor,
    check: (cond, msg) => !cond && problems.push(msg),
    shot: async (name) => {
      await sleep(350) // deja terminar la animación de entrada: si no, la captura sale a medio fundido
      // capturePage saca al <dialog> de la «top layer» y le quita `open` SIN emitir el
      // evento `close`: la promesa del modal se queda colgada y el diálogo huérfano en el
      // DOM. Solo pasa al capturar (un usuario real nunca lo hace), así que se reabre aquí.
      // Se marca el diálogo concreto: buscar «uno cualquiera sin open» resucitaba huérfanos
      // viejos y los apilaba sobre el actual.
      await run(`(() => { const d = document.querySelector('dialog[open]'); if (d) d.dataset.capturando = '1' })()`)

      // Una captura es diagnóstico, no una aserción: si falla no debe tumbar la prueba.
      // Tras un location.reload() el compositor puede no estar listo y devuelve
      // UnknownVizError; se reintenta una vez y, si no, se avisa y se sigue.
      for (let intento = 1; intento <= 2; intento++) {
        try {
          writeFileSync(join(outDir, `${prefix}-${name}.png`), (await win.webContents.capturePage()).toPNG())
          break
        } catch (err) {
          if (intento === 2) console.warn(`  (aviso) no se pudo capturar «${name}»: ${err.message}`)
          else await sleep(600)
        }
      }
      await run(`(() => {
        const d = document.querySelector('dialog[data-capturando]')
        if (!d) return
        delete d.dataset.capturando
        if (!d.open && d.isConnected) d.showModal()
      })()`)
    },
    key: (k, opts = {}) =>
      run(`window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...opts })}))`),
    /** Texto del toast más reciente; espera a que aparezca uno nuevo. */
    lastToast: () => run(`[...document.querySelectorAll('.toast')].at(-1)?.textContent.trim() ?? ''`),
    finish: (okMessage) => {
      console.log(problems.length ? `FALLO:\n- ${problems.join('\n- ')}` : `OK · ${okMessage}`)
      app.exit(problems.length ? 1 : 0)
    }
  }
}

/** Sin esto, una excepción deja la app abierta y la prueba se cuelga en vez de fallar. */
export const fail = (err) => {
  console.error('FALLO: la prueba lanzó una excepción\n', err)
  app.exit(1)
}
