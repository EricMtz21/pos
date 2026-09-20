import { app, BrowserWindow, Menu, dialog, shell } from 'electron'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from './db/connection.js'
import { createRepos } from './db/repos/index.js'
import { backupDatabase } from './db/backup.js'
import { restoreDatabase } from './data-files.js'
import { autoBackup } from './auto-backup.js'
import { createUpdater } from './updater.js'
// electron-updater es CommonJS: en el bundle se toma su export por defecto.
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater
import { seedSampleData } from './db/seed.js'
import { registerIpc } from './ipc/index.js'

// POS_DATA_DIR permite mover los datos (build portable, pruebas). Por defecto: userData,
// que vive fuera del paquete, así las actualizaciones no tocan la base.
if (process.env.POS_DATA_DIR) app.setPath('userData', process.env.POS_DATA_DIR)

let db
let mainWindow = null

/**
 * Un fallo al arrancar deja la aplicación sin ventana y sin explicación: en un mostrador
 * eso es una caja que «no abre» sin más. Se registra en un archivo y se muestra tal cual,
 * que es lo único accionable cuando ni siquiera hay interfaz donde poner un aviso.
 */
function fatal(err, etapa) {
  const mensaje = `${new Date().toISOString()} [${etapa}] ${err?.stack ?? err}\n`
  for (const dir of [safeUserData(), app.getPath('temp')]) {
    try {
      appendFileSync(join(dir, 'pos-error.log'), mensaje)
      break
    } catch {
      // Si no se puede escribir ahí, se intenta en la siguiente ruta.
    }
  }
  dialog.showErrorBox(
    'No se pudo iniciar el punto de venta',
    `${err?.message ?? err}\n\nDetalle guardado en pos-error.log.`
  )
  app.exit(1)
}

const safeUserData = () => {
  try {
    return app.getPath('userData')
  } catch {
    return app.getPath('temp')
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'POS',
    backgroundColor: '#0D0F12',
    webPreferences: {
      // __dirname: el bundle de main se emite como CommonJS (ver electron.vite.config.js).
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow = win
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    mainWindow = null
  })

  // Los enlaces externos se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  try {
    arrancar()
  } catch (err) {
    fatal(err, 'arranque')
  }
})

function arrancar() {
  Menu.setApplicationMenu(null)

  const dataDir = app.getPath('userData')
  const backupDir = join(dataDir, 'backups')
  const dbPath = join(dataDir, 'pos.sqlite')
  db = openDatabase(dbPath, { backupDir })
  const repos = createRepos(db)
  if (!app.isPackaged && process.env.POS_SEED === '1') seedSampleData(repos)

  // §5.5: respaldo automático al arrancar, como mucho uno al día.
  try {
    autoBackup({ backupDir, backup: (label) => backupDatabase(db, backupDir, label) })
  } catch (err) {
    // Que falle el respaldo no debe impedir abrir la caja.
    console.error('[backup] respaldo automático falló:', err)
  }

  const updater = createUpdater({
    autoUpdater,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    // El progreso de descarga llega por evento; la ventana puede no existir todavía.
    onState: (state) => mainWindow?.webContents.send('updates:state', state)
  })

  registerIpc({
    repos,
    updater,
    appInfo: { name: app.getName(), version: app.getVersion() },
    backup: (label) => backupDatabase(db, backupDir, label),
    data: {
      paths: { dataDir, backupDir, dbPath },
      restore: (source) =>
        restoreDatabase({
          source,
          dbPath,
          backupDir,
          db,
          closeDb: () => {
            db.close()
            db = null // evita que 'will-quit' intente cerrarla otra vez
          }
        })
    }
  })
  createWindow()

  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow())
}

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => db?.close())

// Un fallo asíncrono tampoco debe dejar la aplicación muda.
process.on('uncaughtException', (err) => fatal(err, 'excepción no capturada'))
