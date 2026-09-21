// Prueba de humo de la Fase 7: devoluciones, cancelaciones, historial, usuarios y
// permisos por rol. Uso: npm run smoke:extras
import electron from 'electron'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { bootApp, setup, fail } from './smoke-lib.js'

await bootApp(import.meta.dirname)

electron.app.whenReady().then(async () => {
  const { run, check, waitFor, shot, key, finish } = await setup({ prefix: 'ext' })
  const dataDir = electron.app.getPath('userData')

  // §5.5: al arrancar debe haber quedado un respaldo automático.
  const respaldos = readdirSync(join(dataDir, 'backups'))
  check(respaldos.some((f) => /auto\.sqlite$/.test(f)), `respaldo automático al arrancar: ${respaldos.join(', ')}`)

  // ── Una venta para devolver ──
  const venta = await run(`(async () => {
    const r = await window.api.products.findByCode('7501055300020')  // $18.00
    const a = await window.api.products.findByCode('7501000222222')  // $28.00
    const v = await window.api.sales.create({
      items: [{ productId: r.id, qty: 3, unitPrice: 1800 }, { productId: a.id, qty: 2, unitPrice: 2800 }],
      payments: [{ method: 'cash', amount: 11000 }], cashReceived: 11000 })
    return { id: v.id, folio: v.folio, stock: (await window.api.products.findByCode('7501055300020')).stock }
  })()`)
  check(venta.stock === 33, `stock tras vender: ${venta.stock} (36 - 3)`)

  await key('r', { ctrlKey: true })
  await waitFor(`document.querySelector('#r-sales tr[data-sale]')`, 'Ctrl+R abre Reportes')

  // ── Devolución parcial ──
  await run(`document.querySelector('#r-sales tr[data-sale] [data-act="return"]').click()`)
  await waitFor(`document.querySelector('.return-items')`, 'se abre la devolución')

  const disponibles = await run(`[...document.querySelectorAll('.return-items tbody tr')].length`)
  check(disponibles === 2, `líneas devolvibles: ${disponibles}`)

  await run(`(() => {
    const i = document.querySelector('[data-qty]')
    i.value = '1'; i.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await waitFor(`document.querySelector('#return-total').textContent.includes('18.00')`, 'el total de la devolución se calcula')

  // El tope por línea se respeta aunque se escriba de más.
  await run(`(() => {
    const i = document.querySelector('[data-qty]')
    i.value = '99'; i.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  check((await run(`document.querySelector('[data-qty]').value`)) === '3', 'el campo no se topó al máximo devolvible')
  await run(`(() => {
    const i = document.querySelector('[data-qty]')
    i.value = '1'; i.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await shot('devolucion')

  await run(`document.querySelector('#return-confirm').click()`)
  await waitFor(`/Devolución D/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'se registra la devolución')

  const tras = await run(`(async () => ({
    stock: (await window.api.products.findByCode('7501055300020')).stock,
    venta: (await window.api.sales.get(${venta.id})).status,
    resumen: (await window.api.reports.get({ from: new Date().toLocaleDateString('en-CA'), to: new Date().toLocaleDateString('en-CA') })).summary
  }))()`)
  check(tras.stock === 34, `el stock no se repuso: ${tras.stock} (esperado 34)`)
  check(tras.venta === 'completed', `la devolución parcial no debe cerrar la venta: ${tras.venta}`)
  check(tras.resumen.returns === 1800, `devoluciones en el resumen: ${tras.resumen.returns}`)
  check(tras.resumen.gross === 11000, `el bruto no debe cambiar: ${tras.resumen.gross}`)
  check(tras.resumen.net === 11000 - 1800, `el neto debe bajar: ${tras.resumen.net}`)

  // No se puede devolver más de lo que queda.
  // El script inyectado no es un módulo: `await` solo vale dentro de una función async.
  const exceso = await run(`(async () => {
    const items = await window.api.returns.items(${venta.id})
    return window.api.returns.create({ saleId: ${venta.id}, items: [{ saleItemId: items[0].id, qty: 99 }] })
      .then(() => 'ACEPTADO').catch(e => e.message)
  })()`)
  check(/solo quedan/.test(exceso), `devolver de más debería fallar: ${exceso}`)

  // ── Cancelación ──
  // Una venta con devoluciones ya no se puede cancelar: repondría el stock dos veces.
  const rechazo = await run(`window.api.sales.cancel(${venta.id}).then(() => 'ACEPTADO').catch(e => e.message)`)
  check(/ya tiene devoluciones/.test(rechazo), `cancelar tras devolver debería fallar: ${rechazo}`)
  check(
    (await run(`window.api.products.findByCode('7501055300020').then(p => p.stock)`)) === 34,
    'el intento rechazado alteró el stock'
  )

  // Una venta limpia sí se cancela, y repone exactamente lo suyo.
  const limpia = await run(`(async () => {
    const r = await window.api.products.findByCode('7501055300020')
    const v = await window.api.sales.create({ items: [{ productId: r.id, qty: 2, unitPrice: 1800 }],
      payments: [{ method: 'cash', amount: 3600 }] })
    return { id: v.id, stock: (await window.api.products.findByCode('7501055300020')).stock }
  })()`)
  check(limpia.stock === 32, `stock tras la segunda venta: ${limpia.stock}`)

  await run(`document.querySelector('[data-preset="hoy"]').click()`)
  await waitFor(`document.querySelector('#r-sales tr[data-sale] [data-act="cancel"]')`, 'hay una venta cancelable')
  await run(`document.querySelector('#r-sales tr[data-sale] [data-act="cancel"]').click()`)
  await waitFor(`document.querySelector('dialog[open] [data-close="ok"]')`, 'se pide confirmación para cancelar')
  await run(`document.querySelector('dialog[open] [data-close="ok"]').click()`)
  await waitFor(`/cancelada/.test([...document.querySelectorAll('.toast')].at(-1)?.textContent ?? '')`, 'se cancela la venta')

  const cancelada = await run(`(async () => ({
    estado: (await window.api.sales.get(${limpia.id})).status,
    stock: (await window.api.products.findByCode('7501055300020')).stock
  }))()`)
  check(cancelada.estado === 'cancelled', `estado tras cancelar: ${cancelada.estado}`)
  check(cancelada.stock === 34, `el stock debe reponer solo lo de esa venta: ${cancelada.stock}`)

  // ── Historial ──
  await run(`document.querySelector('#r-audit').click()`)
  await waitFor(`document.querySelector('dialog[open] table')`, 'se abre la actividad')
  const actividad = await run(`document.querySelector('dialog[open] tbody').textContent`)
  check(/Devolución/.test(actividad), 'la actividad no registra la devolución')
  check(/Cancelación/.test(actividad), 'la actividad no registra la cancelación')
  await shot('actividad')
  await run(`document.querySelector('dialog[open]').close()`)

  // Historial de un producto: cambio de precio visible con antes y después.
  await run(`(async () => {
    const p = await window.api.products.findByCode('7501055300020')
    await window.api.products.update(p.id, { price_gross: 2000 })
  })()`)
  await key('i', { ctrlKey: true })
  await waitFor(`document.querySelector('#inv-rows [data-act="history"]')`, 'Ctrl+I abre Inventario')
  await run(`[...document.querySelectorAll('#inv-rows tr')].find(r => /Refresco/.test(r.textContent))
    .querySelector('[data-act="history"]').click()`)
  await waitFor(`document.querySelector('dialog[open] tbody')`, 'se abre el historial del producto')
  const historial = await run(`document.querySelector('dialog[open] tbody').textContent`)
  check(/Precio/.test(historial) && /\$20\.00/.test(historial), `el historial no muestra el cambio de precio: ${historial.slice(0, 160)}`)
  await run(`document.querySelector('dialog[open]').close()`)

  // ── Usuarios y roles ──
  const sinUsuarios = await run(`window.api.auth.state()`)
  check(sinUsuarios.required === false, 'sin usuarios no debería pedirse PIN')
  check(sinUsuarios.role === null, `sin usuarios el rol debe ser nulo: ${sinUsuarios.role}`)

  const creados = await run(`(async () => {
    const admin = await window.api.users.create({ name: 'Eric', role: 'admin', pin: '4321' })
    const caja = await window.api.users.create({ name: 'Ana', role: 'cashier', pin: '1111' })
    return { admin: admin.id, caja: caja.id, state: await window.api.auth.state() }
  })()`)
  check(creados.state.required === true, 'al crear el primer usuario debería exigirse PIN')
  check(creados.state.user?.name === 'Eric',
    `quien crea el primer usuario debe quedar con sesión abierta: ${JSON.stringify(creados.state.user)}`)

  // Y por eso puede seguir configurando: crear al cajero no debe quedar bloqueado.
  check(typeof creados.caja === 'number', 'no se pudo crear el segundo usuario')

  // Sin sesión (tras cerrarla) ya no se puede hacer nada.
  await run(`window.api.auth.logout()`)

  // Sin sesión, con usuarios creados, no se puede hacer nada.
  const sinSesion = await run(`window.api.products.create({ name: 'Colado', price_gross: 100 })
    .then(() => 'ACEPTADO').catch(e => e.message)`)
  check(/no tiene permiso/.test(sinSesion), `sin sesión no debería poder crear productos: ${sinSesion}`)

  // PIN incorrecto.
  const malPin = await run(`window.api.auth.login(${creados.caja}, '0000').then(() => 'ENTRÓ').catch(e => e.message)`)
  check(/PIN incorrecto/.test(malPin), `PIN incorrecto: ${malPin}`)

  // Entra la cajera: puede vender, no puede tocar precios ni ajustes.
  await run(`window.api.auth.login(${creados.caja}, '1111')`)
  const comoCajera = await run(`(async () => ({
    vender: await window.api.sales.create({
      items: [{ productId: (await window.api.products.findByCode('7501000222222')).id, qty: 1, unitPrice: 2800 }],
      payments: [{ method: 'cash', amount: 2800 }] }).then(v => v.folio).catch(e => 'ERROR: ' + e.message),
    corte: await window.api.cashCuts.preview({}).then(() => 'ok').catch(e => 'ERROR'),
    precio: await window.api.products.update(1, { price_gross: 9999 }).then(() => 'ACEPTADO').catch(e => e.message),
    ajustes: await window.api.settings.set({ accent: '#FB7185' }).then(() => 'ACEPTADO').catch(e => e.message),
    devolver: await window.api.returns.create({ saleId: 1, items: [] }).then(() => 'ACEPTADO').catch(e => e.message),
    usuarios: await window.api.users.create({ name: 'X', role: 'admin', pin: '9999' }).then(() => 'ACEPTADO').catch(e => e.message)
  }))()`)
  check(/^V\d/.test(comoCajera.vender), `la cajera debería poder vender: ${comoCajera.vender}`)
  check(comoCajera.corte === 'ok', 'la cajera debería poder ver el corte')
  check(/no tiene permiso/.test(comoCajera.precio), `la cajera no debería cambiar precios: ${comoCajera.precio}`)
  check(/no tiene permiso/.test(comoCajera.ajustes), `la cajera no debería cambiar ajustes: ${comoCajera.ajustes}`)
  check(/no tiene permiso/.test(comoCajera.devolver), `la cajera no debería devolver: ${comoCajera.devolver}`)
  check(/no tiene permiso/.test(comoCajera.usuarios), `la cajera no debería crear usuarios: ${comoCajera.usuarios}`)

  // La interfaz también lo refleja: sin Ajustes en el menú ni botón de nuevo producto.
  await run(`location.reload()`)
  await waitFor(`document.querySelector('.nav-item[data-view]')`, 'la app recarga con la sesión de cajera')
  const menu = await run(`[...document.querySelectorAll('.nav-item[data-view]')].map(b => b.dataset.view)`)
  check(!menu.includes('settings'), `la cajera no debería ver Ajustes: ${menu.join(', ')}`)

  await key('i', { ctrlKey: true })
  await waitFor(`document.querySelector('#inv-rows tr')`, 'Inventario abre para la cajera')
  check(!(await run(`Boolean(document.querySelector('#inv-new'))`)), 'la cajera no debería ver «Nuevo producto»')
  check(!(await run(`Boolean(document.querySelector('#inv-rows [data-act="edit"]'))`)), 'la cajera no debería ver editar')
  check(await run(`Boolean(document.querySelector('#inv-rows [data-act="history"]'))`), 'la cajera sí debería ver el historial')
  await shot('cajera')

  // El administrador recupera todo.
  await run(`window.api.auth.logout()`)
  await run(`window.api.auth.login(${creados.admin}, '4321')`)
  await run(`location.reload()`)
  await waitFor(`document.querySelector('.nav-item[data-view]')`, 'la app recarga con la sesión de administrador')
  const menuAdmin = await run(`[...document.querySelectorAll('.nav-item[data-view]')].map(b => b.dataset.view)`)
  check(menuAdmin.includes('settings'), `el administrador debería ver Ajustes: ${menuAdmin.join(', ')}`)
  // Entrar por la pantalla de PIN debe dejar el rol correcto en la interfaz. Antes no
  // se refrescaba el estado local y un administrador perdía Ajustes hasta recargar.
  await run(`window.api.auth.logout()`)
  await run(`location.reload()`)
  await waitFor(`document.querySelector('.login')`, 'la pantalla de PIN aparece')
  for (const d of ['4', '3', '2', '1']) await key(d)
  await key('Enter')
  await waitFor(`!document.querySelector('.login')`, 'se entra con el PIN')
  check(
    (await run(`[...document.querySelectorAll('.nav-item[data-view]')].map((b) => b.dataset.view)`)).includes('settings'),
    'el administrador perdió Ajustes al entrar por la pantalla de PIN'
  )

  // Bloqueo rápido: cierra la sesión y tapa la pantalla, sin recargar.
  await key('l', { ctrlKey: true })
  await waitFor(`document.querySelector('.login')`, 'Ctrl+L bloquea la caja')
  check((await run(`window.api.auth.state().then((s) => s.user)`)) === null, 'bloquear no cerró la sesión')
  await key('F12')
  check(!(await run(`Boolean(document.querySelector('#pay-amount'))`)), 'los atajos responden detrás del bloqueo')
  for (const d of ['4', '3', '2', '1']) await key(d)
  await key('Enter')
  await waitFor(`!document.querySelector('.login')`, 'se desbloquea con el mismo usuario')

  const cabecera = await run(`document.querySelector('#brand').innerText`)
  check(/Eric/.test(cabecera), `la cabecera debería mostrar quién está en sesión: "${cabecera}"`)
  check(/ADMINISTRADOR/i.test(cabecera), `la cabecera debería mostrar el rol: "${cabecera}"`)

  finish('devoluciones, cancelaciones, historial, usuarios y permisos')
}).catch(fail)
