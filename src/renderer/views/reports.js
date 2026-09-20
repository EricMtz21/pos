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
  let data = null

  container.innerHTML = `
    <div class="toolbar">
      <label class="field inline"><span>Desde</span><input type="date" id="r-from" value="${from}" /></label>
      <label class="field inline"><span>Hasta</span><input type="date" id="r-to" value="${to}" /></label>
      <div class="presets">
        <button class="btn" data-preset="hoy" type="button">Hoy</button>
        <button class="btn" data-preset="semana" type="button">7 días</button>
        <button class="btn" data-preset="mes" type="button">Este mes</button>
        <button class="btn" data-preset="anterior" type="button">Mes pasado</button>
      </div>
      <span class="spacer"></span>
      <button class="btn" id="r-audit" type="button">${icon('info')}Actividad</button>
      <button class="btn" id="r-cut" type="button">${icon('wallet')}Corte de caja ${kbd('Ctrl+B')}</button>
      <button class="btn primary" id="r-export" type="button">${icon('download')}Exportar a Excel</button>
    </div>

    <div class="report-cards" id="r-cards"></div>

    <div class="report-grid">
      <section class="panel">
        <h3>Por método de pago</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Método</th><th class="num">Bruto</th><th class="num">Comisión</th><th class="num">Neto</th></tr></thead>
          <tbody id="r-methods"></tbody>
        </table></div>
      </section>

      <section class="panel">
        <h3>Productos más vendidos</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Producto</th><th class="num">Unidades</th><th class="num">Importe</th></tr></thead>
          <tbody id="r-products"></tbody>
        </table></div>
      </section>

      <section class="panel wide">
        <h3>Ventas por día</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Día</th><th class="num">Ventas</th><th class="num">Bruto</th><th class="num">Descuentos</th><th class="num">Comisión</th><th class="num">Neto</th></tr></thead>
          <tbody id="r-days"></tbody>
        </table></div>
      </section>

      <section class="panel wide">
        <h3>Detalle de ventas</h3>
        <div class="table-wrap"><table>
          <thead><tr><th>Folio</th><th>Hora</th><th class="num">Artículos</th><th>Método</th><th class="num">Total</th><th>Estado</th><th></th></tr></thead>
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
  const empty = (cols, text) => `<tr><td colspan="${cols}" class="muted" style="padding:24px;text-align:center">${text}</td></tr>`

  function render() {
    const { summary, byMethod, byDay, topProducts, sales, cuts } = data

    $('#r-cards').innerHTML = [
      ['Ventas', summary.sales, 'shopping-cart'],
      ['Venta bruta', formatMoney(summary.gross), 'banknote'],
      ['Comisiones', summary.commission ? `-${formatMoney(summary.commission)}` : formatMoney(0), 'credit-card'],
      ['Devoluciones', summary.returns ? `-${formatMoney(summary.returns)}` : formatMoney(0), 'refresh-cw'],
      ['Venta neta', formatMoney(summary.net), 'wallet'],
      ['Ticket promedio', formatMoney(summary.averageTicket), 'chart-column']
    ]
      .map(
        ([label, value, ic]) => `<div class="report-card">
          ${icon(ic)}<span class="label">${label}</span><strong>${value}</strong>
        </div>`
      )
      .join('')
    hydrateIcons($('#r-cards'))

    $('#r-methods').innerHTML = byMethod.length
      ? byMethod
          .map(
            (m) => `<tr>
              <td>${METHOD_LABELS[m.method] ?? escape(m.method)}</td>
              <td class="num">${formatMoney(m.gross)}</td>
              <td class="num muted">${m.commission ? `-${formatMoney(m.commission)}` : '—'}</td>
              <td class="num"><strong>${formatMoney(m.net)}</strong></td>
            </tr>`
          )
          .join('')
      : empty(4, 'Sin cobros en el periodo.')

    $('#r-products').innerHTML = topProducts.length
      ? topProducts
          .slice(0, 15)
          .map(
            (p) => `<tr><td>${escape(p.name)}</td><td class="num">${p.qty}</td><td class="num">${formatMoney(p.total)}</td></tr>`
          )
          .join('')
      : empty(3, 'Sin productos vendidos.')

    $('#r-days').innerHTML = byDay.length
      ? byDay
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
      : empty(6, 'Sin ventas en el periodo.')

    $('#r-sales').innerHTML = sales.length
      ? sales
          .map(
            (s) => `<tr data-sale="${s.id}" class="${s.status === 'cancelled' ? 'cancelled' : ''}">
              <td>${escape(s.folio)}</td>
              <td class="muted">${s.created_at.slice(11, 16)}</td>
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
      : empty(7, 'Sin ventas en el periodo.')
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
      : empty(7, 'Todavía no hay cortes registrados.')
  }

  async function refresh() {
    try {
      data = await window.api.reports.get({ from, to })
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
