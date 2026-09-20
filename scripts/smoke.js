// Prueba de humo: arranca la app empaquetada (out/), espera a que el renderer pinte,
// guarda capturas en ambos temas y verifica que el shell existe. Uso: npm run smoke
import electron from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const { app, BrowserWindow } = electron

const outDir = process.env.SMOKE_OUT ?? process.cwd()
await import(pathToFileURL(join(import.meta.dirname, '../out/main/index.cjs')).href)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  await sleep(2500)
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new Error('No se abrió ninguna ventana')

  const check = await win.webContents.executeJavaScript(`({
    theme: document.documentElement.dataset.theme,
    nav: [...document.querySelectorAll('.nav-item[data-view]')].map(b => b.querySelector('.nav-label').textContent),
    kbds: document.querySelectorAll('.nav-item kbd').length,
    icons: document.querySelectorAll('svg.icon').length,
    title: document.querySelector('#view-title').textContent,
    stats: [...document.querySelectorAll('.stat')].map(s => s.textContent.trim()),
    glass: getComputedStyle(document.querySelector('.sidebar')).backdropFilter,
    emojis: /\\p{Extended_Pictographic}/u.test(document.body.innerText)
  })`)
  console.log(JSON.stringify(check, null, 2))

  for (const theme of ['dark', 'light']) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'`)
    await sleep(400)
    const img = await win.webContents.capturePage()
    writeFileSync(join(outDir, `smoke-${theme}.png`), img.toPNG())
  }

  const problems = []
  if (check.nav.length !== 4) problems.push('sidebar incompleto')
  if (check.kbds === 0) problems.push('faltan badges de atajos')
  if (check.icons < 6) problems.push('faltan íconos')
  if (!check.glass.includes('blur')) problems.push('sidebar sin glassmorphism')
  if (check.emojis) problems.push('hay emojis en la UI')
  if (check.stats.length !== 2) problems.push('IPC/SQLite no respondió')

  console.log(problems.length ? `FALLO: ${problems.join(', ')}` : 'OK')
  app.exit(problems.length ? 1 : 0)
})
