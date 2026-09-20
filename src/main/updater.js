// Actualizaciones (§9). Buscarlas requiere internet; **operar el POS no**, así que
// cualquier fallo de red se reporta como estado, nunca como una excepción que rompa la app.
//
// Los datos viven en userData, fuera del paquete, y las migraciones corren al arrancar
// con respaldo previo: por eso actualizar no borra información.

/** Estados posibles, para que la interfaz no invente cadenas sueltas. */
export const STATES = {
  idle: 'idle',
  checking: 'checking',
  available: 'available',
  downloading: 'downloading',
  ready: 'ready',
  upToDate: 'upToDate',
  error: 'error',
  unsupported: 'unsupported' // en desarrollo, o sin feed configurado
}

const MESSAGES = {
  [STATES.idle]: '',
  [STATES.checking]: 'Buscando actualizaciones…',
  [STATES.upToDate]: 'Estás al día.',
  [STATES.downloading]: 'Descargando actualización…',
  [STATES.unsupported]: 'Las actualizaciones automáticas solo funcionan en la aplicación instalada.'
}

/**
 * @param autoUpdater  el autoUpdater de electron-updater (inyectable para poder probarlo)
 * @param isPackaged   en desarrollo no hay paquete que actualizar
 * @param onState      callback con cada cambio de estado, para avisar a la interfaz
 * @param currentVersion
 */
export function createUpdater({ autoUpdater, isPackaged, onState = () => {}, currentVersion }) {
  let state = { status: STATES.idle, message: '', version: null, percent: 0, currentVersion }

  const set = (patch) => {
    state = { ...state, ...patch }
    if (patch.status && patch.message === undefined) state.message = MESSAGES[patch.status] ?? ''
    onState(state)
    return state
  }

  if (autoUpdater) {
    // La descarga la dispara el usuario, no la app: en una caja no se descarga sola.
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) =>
      set({ status: STATES.available, version: info?.version ?? null, message: `Actualización disponible v${info?.version ?? '?'}` })
    )
    autoUpdater.on('update-not-available', () => set({ status: STATES.upToDate, version: null }))
    autoUpdater.on('download-progress', (p) =>
      set({ status: STATES.downloading, percent: Math.round(p?.percent ?? 0) })
    )
    autoUpdater.on('update-downloaded', (info) =>
      set({
        status: STATES.ready,
        version: info?.version ?? state.version,
        percent: 100,
        message: 'Listo para instalar. Se aplicará al reiniciar.'
      })
    )
    autoUpdater.on('error', (err) =>
      set({ status: STATES.error, message: friendlyError(err) })
    )
  }

  /** Traduce los fallos de red a algo que signifique algo en un mostrador. */
  function friendlyError(err) {
    const text = String(err?.message ?? err)
    if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|net::/i.test(text)) {
      return 'No hay conexión a internet. El punto de venta sigue funcionando normalmente.'
    }
    if (/404|No published versions|latest\.yml/i.test(text)) {
      return 'Todavía no hay versiones publicadas para actualizar.'
    }
    return `No se pudo comprobar: ${text}`
  }

  return {
    get state() {
      return state
    },

    async check() {
      if (!isPackaged || !autoUpdater) return set({ status: STATES.unsupported })
      set({ status: STATES.checking })
      try {
        await autoUpdater.checkForUpdates()
      } catch (err) {
        set({ status: STATES.error, message: friendlyError(err) })
      }
      return state
    },

    async download() {
      if (state.status !== STATES.available) throw new Error('No hay ninguna actualización que descargar')
      set({ status: STATES.downloading, percent: 0 })
      try {
        await autoUpdater.downloadUpdate()
      } catch (err) {
        set({ status: STATES.error, message: friendlyError(err) })
      }
      return state
    },

    /** Cierra la app e instala. Al volver a abrir corren las migraciones pendientes. */
    install() {
      if (state.status !== STATES.ready) throw new Error('La actualización todavía no está lista')
      autoUpdater.quitAndInstall()
      return true
    }
  }
}
