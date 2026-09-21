// Gráficos de los reportes. Son SVG y CSS a mano, sin librería: entran tres formas y
// nada más, y meter 300 KB de dependencia para dibujar barras no se paga.
//
// Sin ventas en el periodo no se enseña un hueco con un aviso: se dibuja el mismo
// gráfico en gris, con la forma que tendría al llenarse. Así se entiende de un vistazo
// qué va a aparecer ahí, y la pantalla no se ve rota mientras no se ha vendido nada.
import { formatMoney } from '../../shared/money.js'

const escape = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

/** Cifras cortas para los ejes: en una etiqueta de 30 px no cabe «$12,450.00». */
function shortMoney(cents) {
  const pesos = cents / 100
  if (pesos >= 1000) return `$${(pesos / 1000).toFixed(pesos >= 10000 ? 0 : 1)}k`
  return `$${Math.round(pesos)}`
}

/** '2026-09-21' → '21 sep'. El año no aporta: el rango ya está arriba. */
function dayLabel(iso) {
  const [, mes, dia] = iso.split('-')
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  return `${Number(dia)} ${meses[Number(mes) - 1] ?? ''}`
}

// Alturas de las barras de relleno. Fijas y no aleatorias: un fantasma que cambia de
// forma en cada repintado parece un fallo, no un dibujo.
const FANTASMA_BARRAS = [38, 62, 45, 78, 55, 88, 70]
const FANTASMA_RANKING = [92, 74, 58, 44, 30]

// Días sin venta también son información: un hueco en la semana se ve, y una barra
// suelta en medio de la nada no dice nada. Se rellena el rango completo, salvo que sea
// tan largo que las barras dejarían de leerse.
const MAXIMO_DIAS = 62

function serieCompleta(byDay, from, to) {
  const conVenta = new Map(byDay.map((d) => [d.day, d]))
  const dias = []
  const fin = new Date(`${to}T12:00:00`)
  for (let d = new Date(`${from}T12:00:00`); d <= fin && dias.length <= MAXIMO_DIAS; d.setDate(d.getDate() + 1)) {
    const iso = d.toLocaleDateString('en-CA')
    dias.push(conVenta.get(iso) ?? { day: iso, gross: 0, sales: 0 })
  }
  // Rango demasiado largo: se dibujan solo los días con venta, de viejo a nuevo.
  return dias.length > MAXIMO_DIAS ? [...byDay].reverse() : dias
}

/**
 * Barras verticales de la venta por día. Se dibuja el bruto; el neto va en la tabla,
 * que es donde se leen las cifras exactas.
 */
export function dayChart(byDay, { from, to } = {}) {
  if (!byDay.length) {
    return `<div class="chart chart-ghost" role="img" aria-label="Sin ventas en el periodo">
      <div class="chart-plot">
        <div class="bars">
          ${FANTASMA_BARRAS.map(
            (h, i) => `<div class="bar-slot"><div class="bar ghost" style="--h:${h}%;--i:${i}"></div></div>`
          ).join('')}
        </div>
      </div>
      <p class="chart-note">Aquí se dibuja la venta de cada día en cuanto haya una.</p>
    </div>`
  }

  const max = Math.max(...byDay.map((d) => d.gross), 1)
  // Del más viejo al más nuevo: el tiempo se lee hacia la derecha.
  const dias = from && to ? serieCompleta(byDay, from, to) : [...byDay].reverse()
  // Con muchas barras las fechas se pisan: se rotula una de cada tantas.
  const cada = Math.ceil(dias.length / 12)
  return `<div class="chart chart-bars">
    <div class="chart-plot" style="--max:'${escape(shortMoney(max))}'">
      <span class="chart-axis">${escape(shortMoney(max))}</span>
      <span class="chart-axis half">${escape(shortMoney(Math.round(max / 2)))}</span>
      <div class="bars">
        ${dias
          .map(
            (d, i) => `<div class="bar-slot ${d.gross ? '' : 'vacio'}" title="${escape(dayLabel(d.day))}: ${
              d.gross ? `${formatMoney(d.gross)} en ${d.sales} ${d.sales === 1 ? 'venta' : 'ventas'}` : 'sin ventas'
            }">
              <span class="bar-value">${d.gross ? escape(shortMoney(d.gross)) : ''}</span>
              <div class="bar" style="--h:${d.gross ? Math.max(3, Math.round((d.gross / max) * 100)) : 2}%;--i:${i}"></div>
              <span class="bar-label">${(dias.length - 1 - i) % cada === 0 ? escape(dayLabel(d.day)) : ''}</span>
            </div>`
          )
          .join('')}
      </div>
    </div>
  </div>`
}

/**
 * Dona del reparto por método de pago. El agujero lleva el bruto del periodo: la cifra
 * que se busca primero, y el anillo cuenta de dónde salió.
 */
export function methodDonut(byMethod, labels) {
  if (!byMethod.length) {
    return `<div class="chart chart-ghost" role="img" aria-label="Sin cobros en el periodo">
      <svg class="donut" viewBox="0 0 42 42" aria-hidden="true">
        <circle class="donut-ring ghost" cx="21" cy="21" r="15.9"></circle>
      </svg>
      <p class="chart-note">El reparto entre efectivo y tarjeta aparece al primer cobro.</p>
    </div>`
  }

  const total = byMethod.reduce((sum, m) => sum + m.gross, 0)
  // La circunferencia se toma como 100 para que cada tramo sea directamente su porcentaje.
  let offset = 25 // arranca arriba, no a las tres en punto
  const tramos = byMethod.map((m, i) => {
    const pct = total ? (m.gross / total) * 100 : 0
    // Se recorta un pelo cada tramo para que se vea la junta: sin corte, dos tonos
    // parecidos se leen como un solo bloque.
    const dash = `${Math.max(pct - 0.9, 0.4)} ${100 - Math.max(pct - 0.9, 0.4)}`
    const svg = `<circle class="donut-seg" cx="21" cy="21" r="15.9" style="--tono:${i}"
      stroke-dasharray="${dash}" stroke-dashoffset="${offset}"
      ><title>${escape(labels[m.method] ?? m.method)}: ${formatMoney(m.gross)}</title></circle>`
    offset = (offset - pct + 100) % 100
    return { ...m, pct, svg }
  })

  return `<div class="chart chart-donut">
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 42 42">
        <circle class="donut-ring" cx="21" cy="21" r="15.9"></circle>
        ${tramos.map((t) => t.svg).join('')}
      </svg>
      <div class="donut-center">
        <span>Bruto</span>
        <strong>${formatMoney(total)}</strong>
      </div>
    </div>
    <ul class="chart-legend">
      ${tramos
        .map(
          (t, i) => `<li style="--tono:${i}">
            <span class="dot"></span>
            <span class="leyenda-nombre">${escape(labels[t.method] ?? t.method)}</span>
            <span class="leyenda-pct">${t.pct.toFixed(0)} %</span>
            <strong>${formatMoney(t.gross)}</strong>
          </li>`
        )
        .join('')}
    </ul>
  </div>`
}

/** Barras horizontales del ranking de productos: el nombre se lee, la barra compara. */
export function productBars(topProducts) {
  if (!topProducts.length) {
    return `<div class="chart chart-ghost" role="img" aria-label="Sin productos vendidos">
      <div class="rank ghost">
        ${FANTASMA_RANKING.map(
          (w, i) => `<div class="rank-row"><span class="rank-bar ghost" style="--w:${w}%;--i:${i}"></span></div>`
        ).join('')}
      </div>
      <p class="chart-note">Los más vendidos se ordenan solos conforme se vende.</p>
    </div>`
  }

  const top = topProducts.slice(0, 6)
  const max = Math.max(...top.map((p) => p.qty), 1)
  return `<div class="chart chart-rank">
    <div class="rank">
      ${top
        .map(
          (p, i) => `<div class="rank-row" title="${escape(p.name)}: ${p.qty} en ${formatMoney(p.total)}">
            <span class="rank-name">${escape(p.name)}</span>
            <span class="rank-track"><span class="rank-bar" style="--w:${Math.max(3, Math.round((p.qty / max) * 100))}%;--i:${i}"></span></span>
            <span class="rank-qty">${p.qty}</span>
          </div>`
        )
        .join('')}
    </div>
  </div>`
}
