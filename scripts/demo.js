// Llena una base de datos con una tienda de ejemplo —catálogo, seis semanas de ventas,
// devoluciones y cortes de caja— y abre la aplicación apuntando a ella.
//
//   npm run demo           genera y abre la app con los datos de ejemplo
//   npm run demo -- datos  solo genera la base, sin abrir nada
//
// Los datos NO tocan la instalación real: viven en `.demo-data/` dentro del proyecto.
// Las ventas se crean con los repositorios de verdad (mismo cálculo de IVA, comisiones y
// totales que el mostrador) y solo después se les cambia la fecha: así los números son
// los que el programa habría sacado, no unos escritos a mano.
import { spawn } from 'node:child_process'
import { existsSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { openDatabase } from '../src/main/db/connection.js'
import { createRepos } from '../src/main/db/repos/index.js'
import { CATALOGO, NEGOCIO } from './demo-catalogo.js'

const SEMANAS = 6
const CARPETA = join(import.meta.dirname, '..', '.demo-data')

// Azar reproducible: el mismo comando da siempre la misma tienda, y una captura de
// pantalla de ayer sigue cuadrando con los números de hoy.
function azar(semilla) {
  let a = semilla
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = azar(20260922)
const entre = (min, max) => min + Math.floor(rnd() * (max - min + 1))
const alguno = (lista) => lista[Math.floor(rnd() * lista.length)]

const fecha = (dia) => dia.toLocaleDateString('en-CA')
const conHora = (dia, h, m) => `${fecha(dia)} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`

/** Elige un producto según su peso: los accesorios salen mucho más seguido que una figura. */
function productoAlAzar(productos) {
  const total = productos.reduce((s, p) => s + p.peso, 0)
  let n = rnd() * total
  for (const p of productos) if ((n -= p.peso) <= 0) return p
  return productos.at(-1)
}

/** Cuántas ventas tuvo ese día. Cierra los lunes, y el fin de semana es lo fuerte. */
function ventasDelDia(dia) {
  const d = dia.getDay()
  if (d === 1) return 0 // lunes cerrado
  if (d === 0) return entre(4, 9) // domingo
  if (d === 6) return entre(6, 12) // sábado
  return entre(2, 6)
}

/** Reparte el cobro. La mayoría paga con una sola forma; el pago mixto es la excepción. */
function formaDePago(total) {
  const n = rnd()
  if (n < 0.38) return { payments: [{ method: 'cash', amount: total }], efectivo: true }
  if (n < 0.62) return { payments: [{ method: 'debit', amount: total }] }
  if (n < 0.88) return { payments: [{ method: 'credit', amount: total }] }
  if (n < 0.95) return { payments: [{ method: 'transfer', amount: total }] }
  // Mixto: una parte en efectivo, el resto con tarjeta.
  const enEfectivo = Math.round(total * (0.3 + rnd() * 0.4) * 0.01) * 100
  return {
    payments: [
      { method: 'cash', amount: enEfectivo },
      { method: alguno(['debit', 'credit']), amount: total - enEfectivo }
    ],
    efectivo: true
  }
}

/** Con cuánto pagó: nadie da el importe exacto en efectivo, redondea al billete de arriba. */
function billete(total) {
  for (const b of [5000, 10000, 20000, 50000, 100000]) if (total <= b) return b
  return Math.ceil(total / 50000) * 50000
}

function generar() {
  if (existsSync(CARPETA)) rmSync(CARPETA, { recursive: true, force: true })
  mkdirSync(CARPETA, { recursive: true })

  const db = openDatabase(join(CARPETA, 'pos.sqlite'))
  const repos = createRepos(db)

  repos.settings.set({
    business: NEGOCIO,
    lowStockThreshold: 2, // con piezas contadas, dos ya es para reponer
    cardCommission: {
      enabled: true,
      period: 'monthly',
      applyIvaOnCommission: false,
      byMethod: {
        credit: { tiers: [{ min: 0, pct: 3.6 }, { min: 15000000, pct: 3.1 }] },
        debit: { tiers: [{ min: 0, pct: 3.6 }, { min: 15000000, pct: 3.1 }] }
      }
    }
  })

  // ── 1. Se planean las ventas ANTES de crear los productos ──
  // Así el stock inicial se calcula para que, después de vender todo lo planeado, cada
  // producto quede justo en el número que debe tener hoy. Nada de ajustes inventados
  // al final para cuadrar el inventario.
  const hoy = new Date()
  const plan = []
  const vendidas = new Map()

  for (let atras = SEMANAS * 7; atras >= 0; atras--) {
    const dia = new Date(hoy)
    dia.setDate(hoy.getDate() - atras)

    for (let i = 0; i < ventasDelDia(dia); i++) {
      const lineas = []
      const cuantosProductos = rnd() < 0.62 ? 1 : rnd() < 0.85 ? 2 : 3
      for (let j = 0; j < cuantosProductos; j++) {
        const p = productoAlAzar(CATALOGO)
        if (lineas.some((l) => l.code === p.code)) continue
        // De los accesorios baratos se llevan varios; de una figura de $2,000, una.
        const qty = p.gross <= 25900 ? entre(1, 3) : 1
        lineas.push({ code: p.code, qty })
        vendidas.set(p.code, (vendidas.get(p.code) ?? 0) + qty)
      }
      // La tienda abre a las 11:00 y cierra a las 20:00.
      plan.push({ dia, hora: entre(11, 19), minuto: entre(0, 59), lineas })
    }
  }
  plan.sort((a, b) => conHora(a.dia, a.hora, a.minuto).localeCompare(conHora(b.dia, b.hora, b.minuto)))

  // ── 2. Catálogo, con el stock inicial que deja el final en su sitio ──
  const porCodigo = new Map()
  for (const p of CATALOGO) {
    const tax = p.tax ?? 0.16
    porCodigo.set(
      p.code,
      repos.products.create({
        code: p.code,
        name: p.name,
        price_gross: p.gross,
        price_net: Math.round(p.gross / (1 + tax)),
        cost: p.cost,
        stock: p.objetivo + (vendidas.get(p.code) ?? 0),
        tax_rate: tax
      })
    )
  }

  // ── 3. Las ventas, con los repositorios de verdad ──
  const folios = new Map()
  const ventas = []

  // El folio lo numera el repositorio con la fecha de hoy; aquí se renumera con la del día
  // que le toca, y se arrastra al movimiento de inventario, que lo usa de referencia.
  const moverFecha = db.transaction((venta, cuando) => {
    const dia = cuando.slice(0, 10).replaceAll('-', '')
    const consecutivo = (folios.get(dia) ?? 0) + 1
    folios.set(dia, consecutivo)
    const folio = `V${dia}-${String(consecutivo).padStart(4, '0')}`

    db.prepare('UPDATE inventory_moves SET reason = ?, created_at = ? WHERE reason = ?').run(folio, cuando, venta.folio)
    db.prepare(
      "UPDATE audit_log SET after_json = REPLACE(after_json, ?, ?), created_at = ? WHERE entity = 'sale' AND entity_id = ?"
    ).run(venta.folio, folio, cuando, venta.id)
    db.prepare('UPDATE sales SET folio = ?, created_at = ? WHERE id = ?').run(folio, cuando, venta.id)
    return folio
  })

  for (const v of plan) {
    const items = v.lineas.map((l) => {
      const p = porCodigo.get(l.code)
      return { productId: p.id, qty: l.qty, unitPrice: p.price_gross }
    })

    // Una de cada doce ventas lleva descuento: cliente frecuente, caja maltratada, o el
    // clásico «llévate las dos».
    const bruto = items.reduce((s, i) => s + i.qty * i.unitPrice, 0)
    const discount = rnd() < 0.085 ? Math.round((bruto * alguno([0.05, 0.1, 0.15])) / 100) * 100 : 0
    const total = bruto - discount
    const pago = formaDePago(total)

    const venta = repos.sales.create({
      items,
      discount,
      payments: pago.payments,
      cashReceived: pago.efectivo ? billete(pago.payments.find((p) => p.method === 'cash').amount) : null
    })
    const cuando = conHora(v.dia, v.hora, v.minuto)
    ventas.push({ id: venta.id, folio: moverFecha(venta, cuando), cuando, total: venta.total })
  }

  // ── 4. Tres devoluciones y una venta cancelada ──
  // Pasa de verdad: llega con la figura equivocada, o el cliente se arrepiente.
  const devolubles = ventas.filter((v) => v.total > 30000)
  for (const v of [devolubles.at(-31), devolubles.at(-18), devolubles.at(-6)]) {
    if (!v) continue
    const [linea] = repos.returns.returnableItems(v.id)
    if (!linea) continue
    const devolucion = repos.returns.create({
      saleId: v.id,
      items: [{ saleItemId: linea.id, qty: 1 }],
      method: 'cash',
      reason: alguno(['Se llevó la equivocada', 'Caja dañada', 'Cambio por otra figura'])
    })
    // Se devuelve al cierre de ese día, no en el mismo minuto de la compra.
    const cuando = `${v.cuando.slice(0, 10)} 18:40:00`
    db.prepare('UPDATE returns SET created_at = ? WHERE id = ?').run(cuando, devolucion.id)
    db.prepare('UPDATE inventory_moves SET created_at = ? WHERE reason = ?').run(cuando, `Devolución ${devolucion.folio}`)
  }

  const cancelada = ventas.at(-12)
  if (cancelada) repos.sales.cancel(cancelada.id, { reason: 'Se canceló antes de entregar' })

  // ── 5. Cortes de caja de los días ya cerrados ──
  // El fondo es el mismo todos los días; la diferencia es de unos pesos, como en la vida.
  const dias = [...new Set(ventas.map((v) => v.cuando.slice(0, 10)))].slice(0, -1)
  for (const dia of dias.slice(-12)) {
    const previo = repos.cashCuts.preview({ businessDate: dia, opening: 100000 })
    if (previo.sales === 0) continue
    const desfase = alguno([0, 0, 0, -2000, -500, 1000, -10000])
    const corte = repos.cashCuts.create({
      businessDate: dia,
      opening: 100000,
      countedCash: Math.max(0, previo.expectedCash + desfase),
      notes: desfase === 0 ? null : desfase > 0 ? 'Sobró, seguro un cambio mal dado' : 'Faltó, se revisa mañana'
    })
    db.prepare('UPDATE cash_cuts SET created_at = ? WHERE id = ?').run(`${dia} 20:15:00`, corte.id)
  }

  const resumen = repos.reports.summary({ from: ventas[0].cuando.slice(0, 10), to: fecha(hoy) })
  db.close()
  return { ventas: ventas.length, resumen }
}

const pesos = (c) => `$${(c / 100).toLocaleString('es-MX', { minimumFractionDigits: 2 })}`

const { ventas, resumen } = generar()
console.log(`
Tienda de ejemplo lista en ${CARPETA}

  ${CATALOGO.length} productos · ${ventas} ventas en ${SEMANAS} semanas
  Venta bruta    ${pesos(resumen.gross)}
  Devoluciones   ${pesos(resumen.returns)}
  Comisiones     ${pesos(resumen.commission)}
  Venta sin IVA  ${pesos(resumen.netRevenue)}
  Costo          ${pesos(resumen.cost)}
  Utilidad       ${pesos(resumen.profit)}
`)

if (!process.argv.includes('datos')) {
  const { default: electron } = await import('electron')
  // OJO: ELECTRON_RUN_AS_NODE viene puesto en esta terminal y haría que el .exe corriera
  // como Node puro y saliera al instante. Se quita para el proceso hijo.
  const env = { ...process.env, POS_DATA_DIR: CARPETA }
  delete env.ELECTRON_RUN_AS_NODE
  spawn(electron, ['.'], { env, stdio: 'inherit', cwd: join(import.meta.dirname, '..') })
}
