import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createUpdater, STATES } from '../src/main/updater.js'

/** autoUpdater de mentira: emite lo mismo que electron-updater, sin red. */
function fakeAutoUpdater({ onCheck, onDownload } = {}) {
  const emitter = new EventEmitter()
  emitter.checkForUpdates = async () => onCheck?.(emitter)
  emitter.downloadUpdate = async () => onDownload?.(emitter)
  emitter.quitAndInstall = () => {
    emitter.installed = true
  }
  return emitter
}

const build = (autoUpdater, { isPackaged = true } = {}) => {
  const seen = []
  const updater = createUpdater({
    autoUpdater,
    isPackaged,
    currentVersion: '1.0.0',
    onState: (s) => seen.push({ ...s })
  })
  return { updater, seen }
}

test('en desarrollo no se intenta actualizar nada', async () => {
  const { updater } = build(fakeAutoUpdater(), { isPackaged: false })
  const state = await updater.check()
  assert.equal(state.status, STATES.unsupported)
  assert.match(state.message, /aplicación instalada/)
})

test('sin actualizaciones: «estás al día»', async () => {
  const auto = fakeAutoUpdater({ onCheck: (e) => e.emit('update-not-available') })
  const { updater, seen } = build(auto)

  const state = await updater.check()
  assert.equal(state.status, STATES.upToDate)
  assert.equal(state.message, 'Estás al día.')
  assert.deepEqual(seen.map((s) => s.status), [STATES.checking, STATES.upToDate])
})

test('flujo completo: disponible → descargar → listo para instalar', async () => {
  const auto = fakeAutoUpdater({
    onCheck: (e) => e.emit('update-available', { version: '1.2.0' }),
    onDownload: (e) => {
      e.emit('download-progress', { percent: 42.6 })
      e.emit('update-downloaded', { version: '1.2.0' })
    }
  })
  const { updater } = build(auto)

  const disponible = await updater.check()
  assert.equal(disponible.status, STATES.available)
  assert.equal(disponible.version, '1.2.0')
  assert.match(disponible.message, /Actualización disponible v1\.2\.0/)

  const listo = await updater.download()
  assert.equal(listo.status, STATES.ready)
  assert.equal(listo.percent, 100)
  assert.match(listo.message, /al reiniciar/)

  assert.equal(updater.install(), true)
  assert.equal(auto.installed, true)
})

test('la descarga no arranca sola: la dispara el usuario', () => {
  const auto = fakeAutoUpdater()
  build(auto)
  assert.equal(auto.autoDownload, false, 'una caja no debe ponerse a descargar por su cuenta')
  assert.equal(auto.autoInstallOnAppQuit, true)
})

test('el progreso de descarga se informa en porcentaje redondeado', async () => {
  const auto = fakeAutoUpdater({
    onCheck: (e) => e.emit('update-available', { version: '2.0.0' }),
    onDownload: (e) => {
      e.emit('download-progress', { percent: 12.3 })
      e.emit('download-progress', { percent: 87.9 })
    }
  })
  const { updater, seen } = build(auto)
  await updater.check()
  await updater.download()

  const porcentajes = seen.filter((s) => s.status === STATES.downloading).map((s) => s.percent)
  assert.deepEqual(porcentajes, [0, 12, 88])
})

test('sin internet: se informa, no se rompe', async () => {
  const auto = fakeAutoUpdater({
    onCheck: (e) => e.emit('error', new Error('getaddrinfo ENOTFOUND github.com'))
  })
  const { updater } = build(auto)

  const state = await updater.check()
  assert.equal(state.status, STATES.error)
  assert.match(state.message, /No hay conexión a internet/)
  assert.match(state.message, /sigue funcionando/, 'debe dejar claro que se puede seguir vendiendo')
})

test('sin versiones publicadas todavía: mensaje claro, no un 404 crudo', async () => {
  const auto = fakeAutoUpdater({
    onCheck: (e) => e.emit('error', new Error('HttpError: 404 Not Found latest.yml'))
  })
  const { updater } = build(auto)
  const state = await updater.check()
  assert.match(state.message, /Todavía no hay versiones publicadas/)
})

test('un fallo al comprobar no tumba la aplicación', async () => {
  const auto = fakeAutoUpdater({
    onCheck: () => {
      throw new Error('algo raro')
    }
  })
  const { updater } = build(auto)
  const state = await updater.check() // no debe lanzar
  assert.equal(state.status, STATES.error)
  assert.match(state.message, /algo raro/)
})

test('no se puede descargar ni instalar fuera de orden', async () => {
  const { updater } = build(fakeAutoUpdater())
  await assert.rejects(() => updater.download(), /No hay ninguna actualización que descargar/)
  assert.throws(() => updater.install(), /todavía no está lista/)
})
