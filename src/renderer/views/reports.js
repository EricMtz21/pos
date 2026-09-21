import { icon, hydrateIcons } from '../icons.js'
import { register, kbd } from '../shortcuts/index.js'
import { toast } from '../components/toast.js'
import { openCashCut } from './cash-cut.js'
import { openReturn } from './return-modal.js'
import { showAudit } from './audit-modal.js'
import { showTicket } from './ticket-modal.js'
import { confirmModal } from '../components/modal.js'
import { allowed } from '../session.js'
import { formatMoney } from '../../shared/money.js'
import { dayChart, methodDonut, productBars } from './report-charts.js'

const escape = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

const METHOD_LABELS = {
  cash: 'Efectivo',
  debit: 'Tarjeta débito',
  credit: 'Tarjeta crédito',
  transfer: 'Transferencia',
  mixed: 'Pago mixto'
}
const STATUS_LABELS = { completed: 'Completada', cancelled: 'Cancelada', refunded: 'Devuelta' }

const isoDate = (d) => d.toLocaleDateString('en-CA')

// Rangos rápidos, calculados en fecha local.
const PRESETS = {
  hoy: () => [isoDate(new Date()), isoDate(new Date())],
  semana: () => [isoDate(new Date(Date.now() - 6 * 864e5)), isoDate(new Date())],
  mes: () => {
    const now = new Date()
    return [isoDate(new Date(now.getFullYear(), now.getMonth(), 1)), isoDate(now)]
  },
  anterior: () => {
    const now = new Date()
    return [
      isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      isoDate(new Date(now.getFullYear(), now.getMonth(), 0))
    ]
  }
}

export async function renderReports(container) {
  let [from, to] = PRESETS.hoy()
  let folio = ''
  let data = null

  container.innerHTML = `
    <div class="report-bar">
      <div class="report-period">
        <span class="group-label">Periodo</span>
        <div class="period-controls">
          <input type="date" id="r-from" value="${from}" aria-label="Desde" />
          <span class="muted">a</span>
          <input type="date" id="r-to" value="${to}" aria-label="Hasta" />
          <div class="presets">
            <button class="btn" data-preset="hoy" type="button">Hoy</button>
            <button class="btn" data-preset="semana" type="button">7 días</button>
            <button class="btn" data-preset="mes" type="button">Este mes</button>
            <button class="btn" data-preset="anterior" type="button">Mes pasado</button>
          </div>
        </div>
      </div>

      <div class="report-actions">
        <span class="group-label">Acciones</span>
        <div class="button-row">
          <button class="btn" id="r-audit" type="button">${icon('info')}Actividad</button>
          <button class="btn" id="r-cut" type="button">${icon('wallet')}Corte de caja ${kbd('Ctrl+B')}</button>
          <button class="btn primary" id="r-export" type="button">${icon('download')}Exportar a Excel</button>
        </div>
      </div>
    </div>

    <div class="report-cards" id="r-cards"></div>

    <h2 class="report-section">Cómo se vendió</h2>
    <div class="report-grid">
      <section class="panel">
        <h3>Por método de pago</h3>
        <div id="r-methods-chart"></div>
        <div class="table-wrap" id="r-methods-table"><table>
          <thead><tr><th>Método</th><th class="num">Bruto</th><th class="num">Comisión</th><th class="num">Neto</th></tr></thead>
          <tbody id="r-methods"></tbody>
        </table></div>
      </section>

      <section class="panel">
        <h3>Productos más vendidos</h3>
        <div id="r-products-chart"></div>
        <div class="table-wrap" id="r-products-table"><table>
          <thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Importe</th></tr></thead>
          <tbody id="r-products"></tbody>
        </table></div>
      </section>

      <section class="panel wide">
        <h3>Ventas por día</h3>
        <div id="r-days-chart"></div>
        <div class="table-wrap" id="r-days-table"><table>
          <thead><tr><th>Día</th><th class="num">Ventas</th><th class="num">Bruto</th><th class="num">Descuentos</th><th class="num">Comisión</th><th class="num">Neto</th></tr></thead>
          <tbody id="r-days"></tbody>
        </table></div>
      </section>

    </div>

    <h2 class="report-section">Movimientos</h2>
    <div class="report-grid">
      <section class="panel wide">
        <h3>Detalle de ventas</h3>
        <div class="search" style="margin-bottom:12px;max-width:340px">
          ${icon('search')}
          <input id="r-folio" type="search" autocomplete="off"
                 placeholder="Buscar por folio (ignora el rango de fechas)…" aria-label="Buscar venta por folio" />
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Folio</th><th>Hora</th><th>Cajero</th><th class="num">Artículos</th><th>Método</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
          <tbody id="r-sales"></tbody>
        </table></div>
      </section>

      <section class="panel wide">
        <h3>Cortes de caja</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Fecha</th><th>Hora</th><th class="num">Fondo</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th><th>Notas</th></tr></thead>
          <tbody id="r-cuts"></tbody>
        </table></div>
      </section>
    </div>`
  hydrateIcons(container)

  const $ = (sel) => container.querySelector(sel)
  const empty = (cols, text, ic) => `<tr><td colspan="${cols}" class="table-empty">
    <div class="empty-block">${icon(ic)}<span>${text}</span></div></td></tr>`

  function render() {
    const { summary, byMethod, byDay, topProducts, sales, cuts } = data

    // Dos bloques que cuentan la misma historia que el dinero: lo que se vendió,
    // y lo que queda después de restar comisiones y devoluciones.
    const card = ([label, value, ic, extra = '']) => `<div class="report-card ${extra}">
      <span class="label">${label}</span><strong>${value}</strong>${icon(ic)}
    </div>`

    $('#r-cards').innerHTML = `
      <div class="card-group">
        <span class="group-label">Vendido</span>
        <div class="card-row">
          ${[
            ['Ventas', summary.sales, 'shopping-cart'],
            ['Venta bruta', formatMoney(summary.gross), 'banknote'],
            ['Ticket promedio', formatMoney(summary.averageTicket), 'chart-column']
          ].map(card).join('')}
        </div>
      </div>
      <div class="card-group">
        <span class="group-label">Recibido</span>
        <div class="card-row">
          ${[
            ['Comisiones', summary.commission ? `-${formatMoney(summary.commission)}` : formatMoney(0), 'credit-card'],
            ['Devoluciones', summary.returns ? `-${formatMoney(summary.returns)}` : formatMoney(0), 'refresh-cw'],
            ['Venta neta', formatMoney(summary.net), 'wallet', 'is-net']
          ].map(card).join('')}
        </div>
      </div>`
    hydrateIcons($('#r-cards'))

    // Cada panel agregado se cuenta primero con un gráfico y luego con su tabla. Sin
    // datos, la tabla sobra: el gráfico en gris ya dice qué va a aparecer ahí.
    $('#r-methods-chart').innerHTML = methodDonut(byMethod, METHOD_LABELS)
    $('#r-methods-table').hidden = byMethod.length === 0
    $('#r-methods').innerHTML = byMethod
      .map(
        (m) => `<tr>
          <td>${METHOD_LABELS[m.method] ?? escape(m.method)}</td>
          <td class="num">${formatMoney(m.gross)}</td>
          <td class="num muted">${m.commission ? `-${formatMoney(m.commission)}` : '—'}</td>
          <td class="num"><strong>${formatMoney(m.net)}</strong></td>
        </tr>`
      )
      .join('')

    $('#r-products-chart').innerHTML = productBars(topProducts)
    $('#r-products-table').hidden = topProducts.length === 0
    $('#r-products').innerHTML = topProducts
      .slice(0, 15)
      .map(
        (p) => `<tr><td>${escape(p.name)}</td><td class="num">${p.qty}</td><td class="num">${formatMoney(p.total)}</td></tr>`
      )
      .join('')

    $('#r-days-chart').innerHTML = dayChart(byDay, { from, to })
    $('#r-days-table').hidden = byDay.length === 0
    $('#r-days').innerHTML = byDay
      .map(
        (d) => `<tr>
          <td>${d.day}</td><td class="num">${d.sales}</td>
          <td class="num">${formatMoney(d.gross)}</td>
          <td class="num muted">${d.discounts ? `-${formatMoney(d.discounts)}` : '—'}</td>
          <td class="num muted">${d.commission ? `-${formatMoney(d.commission)}` : '—'}</td>
          <td class="num"><strong>${formatMoney(d.net)}</strong></td>
        </tr>`
      )
      .join('')

    $('#r-sales').innerHTML = sales.length
      ? sales
          .map(
            (s) => `<tr data-sale="${s.id}" class="${s.status === 'cancelled' ? 'cancelled' : ''}">
              <td>${escape(s.folio)}</td>
              <td class="muted">${s.created_at.slice(11, 16)}</td>
              <td class="muted">${escape(s.user_name) || '—'}</td>
              <td class="num">${s.items}</td>
              <td class="muted">${METHOD_LABELS[s.payment_method] ?? escape(s.payment_method)}</td>
              <td class="num"><strong>${formatMoney(s.total)}</strong></td>
              <td><span class="badge ${s.status === 'cancelled' ? 'warn' : ''}">${STATUS_LABELS[s.status] ?? s.status}</span></td>
              <td><div class="row-actions">
                <button class="btn ghost icon-only" data-act="ticket" aria-label="Ver ticket">${icon('printer')}</button>
                ${
                  s.status === 'completed' && allowed('returns:create')
                    ? `<button class="btn ghost icon-only" data-act="return" aria-label="Devolver">${icon('refresh-cw')}</button>`
                    : ''
                }
                ${
                  s.status === 'completed' && allowed('sales:cancel')
                    ? `<button class="btn ghost icon-only danger" data-act="cancel" aria-label="Cancelar venta">${icon('x')}</button>`
                    : ''
                }
              </div></td>
            </tr>`
          )
          .join('')
      : empty(8, folio ? `Ninguna venta con folio «${escape(folio)}».` : 'Sin ventas en el periodo.', 'shopping-cart')
    hydrateIcons($('#r-sales'))

    $('#r-cuts').innerHTML = cuts.length
      ? cuts
          .map(
            (c) => `<tr>
              <td>${c.business_date}</td>
              <td class="muted">${c.created_at.slice(11, 16)}</td>
              <td class="num muted">${formatMoney(c.opening)}</td>
              <td class="num">${formatMoney(c.expected_cash)}</td>
              <td class="num">${formatMoney(c.counted_cash)}</td>
              <td class="num"><strong class="${c.difference < 0 ? 'negative' : ''}">${
                c.difference === 0 ? '—' : `${c.difference > 0 ? '+' : '-'}${formatMoney(Math.abs(c.difference))}`
              }</strong></td>
              <td class="muted">${escape(c.notes) || ''}</td>
            </tr>`
          )
          .join('')
      : empty(7, 'Todavía no hay cortes registrados.', 'wallet')
    hydrateIcons($('#r-cuts'))
  }

  async function refresh() {
    try {
      data = await window.api.reports.get({ from, to, folio })
      render()
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  function setRange(nextFrom, nextTo) {
    // Un rango invertido no devuelve nada: se corrige en vez de mostrar una tabla vacía.
    ;[from, to] = nextFrom > nextTo ? [nextTo, nextFrom] : [nextFrom, nextTo]
    $('#r-from').value = from
    $('#r-to').value = to
    refresh()
  }

  $('#r-from').addEventListener('change', (e) => setRange(e.target.value, to))
  $('#r-to').addEventListener('change', (e) => setRange(from, e.target.value))

  container.querySelectorAll('[data-preset]').forEach((btn) =>
    btn.addEventListener('click', () => setRange(...PRESETS[btn.dataset.preset]()))
  )

  $('#r-sales').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    const id = Number(e.target.closest('[data-sale]').dataset.sale)

    try {
      const sale = await window.api.sales.get(id)
      if (act === 'ticket') return showTicket(sale)

      if (act === 'return') {
        const dev = await openReturn(sale)
        if (!dev?.folio) return
        toast(`Devolución ${dev.folio} · ${formatMoney(dev.total)}`)
        return refresh()
      }

      if (act === 'cancel') {
        const ok = await confirmModal({
          title: `Cancelar la venta ${sale.folio}`,
          message:
            `Se repondrá el stock de los ${sale.items.length} producto(s) y la venta dejará de contar ` +
            `en los reportes. La venta no se borra: queda marcada como cancelada.`,
          confirmLabel: 'Cancelar la venta',
          danger: true
        })
        if (!ok) return
        await window.api.sales.cancel(id)
        toast(`Venta ${sale.folio} cancelada`)
        return refresh()
      }
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  async function exportExcel() {
    try {
      const path = await window.api.reports.export({ from, to })
      if (path) toast(`Reporte guardado: ${path}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  }

  async function cashCut() {
    const cut = await openCashCut(to)
    if (!cut) return
    const diff = cut.difference
    toast(
      diff === 0
        ? 'Corte registrado: la caja cuadra exacto'
        : `Corte registrado: ${diff > 0 ? 'sobran' : 'faltan'} ${formatMoney(Math.abs(diff))}`,
      diff === 0 ? 'info' : 'error'
    )
    await refresh()
  }

  // Buscar un folio concreto no debe disparar una consulta por tecla.
  let folioTimer
  $('#r-folio').addEventListener('input', (e) => {
    clearTimeout(folioTimer)
    folio = e.target.value.trim()
    folioTimer = setTimeout(refresh, 160)
  })

  $('#r-export').addEventListener('click', exportExcel)
  $('#r-cut').addEventListener('click', cashCut)
  $('#r-audit').addEventListener('click', () => showAudit())

  await refresh()

  const disposers = [
    register('Ctrl+B', cashCut, 'Corte de caja'),
    register('Ctrl+E', exportExcel, 'Exportar reporte a Excel')
  ]
  return () => disposers.forEach((off) => off())
}
