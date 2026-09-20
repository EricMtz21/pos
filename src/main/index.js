import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import { openDatabase } from './db/connection.js'
import { createRepos } from './db/repos/index.js'
import { backupDatabase } from './db/backup.js'
import { restoreDatabase } from './data-files.js'
import { seedSampleData } from './db/seed.js'
import { registerIpc } from './ipc/index.js'

// POS_DATA_DIR permite mover los datos (build portable, pruebas). Por defecto: userData,
// que vive fuera del paquete, así las actualizaciones no tocan la base.
if (process.env.POS_DATA_DIR) app.setPath('userData', process.env.POS_DATA_DIR)

let db

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'POS',
    backgroundColor: '#0E0F0D',
    webPreferences: {
      // __dirname: el bundle de main se emite como CommonJS (ver electron.vite.config.js).
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Los enlaces externos se abren en el navegador, nunca dentro de la app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  const dataDir = app.getPath('userData')
  const backupDir = join(dataDir, 'backups')
  const dbPath = join(dataDir, 'pos.sqlite')
  db = openDatabase(dbPath, { backupDir })
  const repos = createRepos(db)
  if (!app.isPackaged && process.env.POS_SEED === '1') seedSampleData(repos)

  registerIpc({
    repos,
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
})

app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => db?.close())
