// Utilidades compartidas por las pruebas de humo.
// Nota: Electron debe arrancar SIN `ELECTRON_RUN_AS_NODE`, o corre como Node puro.
import electron from 'electron'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { app, BrowserWindow } = electron

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Carga el bundle de main (out/) para arrancar la app real. */
export const bootApp = (dir) => import(pathToFileURL(join(dir, '../out/main/index.cjs')).href)

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
  const run = (js) => win.webContents.executeJavaScript(js)

  const waitFor = async (js, label, timeout = 5000) => {
    for (let waited = 0; waited < timeout; waited += 50) {
      if (await run(`Boolean(${js})`)) return true
      await sleep(50)
    }
    // Al agotarse, se informa qué había en pantalla: un timeout a secas no dice nada.
    const contexto = await run(`({
      toast: [...document.querySelectorAll('.toast')].at(-1)?.textContent.trim() ?? '(ninguno)',
      dialog: document.querySelector('dialog[open] h2')?.textContent ?? '(ninguno)'
    })`).catch(() => ({ toast: '?', dialog: '?' }))
    problems.push(`agotó la espera: ${label} · último aviso: "${contexto.toast}" · modal abierto: ${contexto.dialog}`)
    return false
  }

  return {
    win,
    run,
    problems,
    waitFor,
    check: (cond, msg) => !cond && problems.push(msg),
    shot: async (name) => {
      await sleep(350) // deja terminar la animación de entrada: si no, la captura sale a medio fundido
      writeFileSync(join(outDir, `${prefix}-${name}.png`), (await win.webContents.capturePage()).toPNG())
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
