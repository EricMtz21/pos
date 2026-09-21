// Este módulo NO importa electron a propósito: así el libro se puede construir y verificar
// con Node puro en las pruebas. El diálogo de guardado vive en la capa IPC.
import ExcelJS from 'exceljs'

// El dinero se guarda en centavos; a Excel va en pesos con formato de moneda,
// para que el usuario pueda sumar y filtrar sin convertir nada.
const MONEY = '"$"#,##0.00'
const pesos = (cents) => (cents ?? 0) / 100

const METHOD_LABELS = {
  cash: 'Efectivo',
  debit: 'Tarjeta débito',
  credit: 'Tarjeta crédito',
  transfer: 'Transferencia',
  mixed: 'Pago mixto'
}
const STATUS_LABELS = { completed: 'Completada', cancelled: 'Cancelada', refunded: 'Devuelta' }

/** Hoja con encabezado en negritas, anchos fijos y formato por columna. */
function addSheet(book, name, columns, rows) {
  const sheet = book.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }))
  sheet.getRow(1).font = { bold: true }

  for (const row of rows) sheet.addRow(row)

  columns.forEach((c, i) => {
    if (c.money) sheet.getColumn(i + 1).numFmt = MONEY
  })
  // Autofiltro solo si hay datos: Excel marca el archivo como dañado si el rango está vacío.
  if (rows.length > 0) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  }
  return sheet
}

/**
 * Construye el libro con los datos del periodo.
 * @returns ExcelJS.Workbook
 */
export function buildWorkbook({ from, to, summary, byDay, byMethod, topProducts, sales, cuts, business }) {
  const book = new ExcelJS.Workbook()
  book.creator = business?.name || 'POS'
  book.created = new Date()

  // ── Resumen ──
  const resumen = book.addWorksheet('Resumen')
  resumen.columns = [{ width: 26 }, { width: 18 }]
  const rows = [
    ['Negocio', business?.name || ''],
    ['Periodo', from === to ? from : `${from} a ${to}`],
    ['Generado', new Date().toLocaleString('es-MX')],
    [],
    ['Ventas', summary.sales],
    ['Venta bruta', pesos(summary.gross), true],
    ['Descuentos', pesos(summary.discounts), true],
    ['IVA incluido', pesos(summary.tax), true],
    ['Comisiones de tarjeta', pesos(summary.commission), true],
    ['Venta neta', pesos(summary.net), true],
    ['Ticket promedio', pesos(summary.averageTicket), true]
  ]
  rows.forEach(([label, value, money]) => {
    const row = resumen.addRow([label, value])
    if (money) row.getCell(2).numFmt = MONEY
    if (label === 'Venta neta') row.font = { bold: true }
  })
  resumen.getColumn(1).font = { bold: false }
  resumen.getRow(1).font = { bold: true }

  // ── Ventas por día ──
  addSheet(
    book,
    'Ventas por día',
    [
      { header: 'Día', key: 'day', width: 14 },
      { header: 'Ventas', key: 'sales', width: 10 },
      { header: 'Venta bruta', key: 'gross', money: true },
      { header: 'Descuentos', key: 'discounts', money: true },
      { header: 'Comisiones', key: 'commission', money: true },
      { header: 'Venta neta', key: 'net', money: true }
    ],
    byDay.map((d) => ({
      day: d.day,
      sales: d.sales,
      gross: pesos(d.gross),
      discounts: pesos(d.discounts),
      commission: pesos(d.commission),
      net: pesos(d.net)
    }))
  )

  // ── Métodos de pago ──
  addSheet(
    book,
    'Métodos de pago',
    [
      { header: 'Método', key: 'method', width: 18 },
      { header: 'Cobros', key: 'payments', width: 10 },
      { header: 'Venta bruta', key: 'gross', money: true },
      { header: 'Comisión', key: 'commission', money: true },
      { header: 'Neto recibido', key: 'net', money: true }
    ],
    byMethod.map((m) => ({
      method: METHOD_LABELS[m.method] ?? m.method,
      payments: m.payments,
      gross: pesos(m.gross),
      commission: pesos(m.commission),
      net: pesos(m.net)
    }))
  )

  // ── Productos ──
  addSheet(
    book,
    'Productos',
    [
      { header: 'Producto', key: 'name', width: 38 },
      { header: 'Unidades', key: 'qty', width: 12 },
      { header: 'Importe', key: 'total', money: true }
    ],
    topProducts.map((p) => ({ name: p.name, qty: p.qty, total: pesos(p.total) }))
  )

  // ── Detalle de ventas ──
  addSheet(
    book,
    'Ventas',
    [
      { header: 'Folio', key: 'folio', width: 18 },
      { header: 'Fecha', key: 'date', width: 20 },
      { header: 'Cajero', key: 'user', width: 18 },
      { header: 'Artículos', key: 'items', width: 10 },
      { header: 'Método', key: 'method', width: 16 },
      { header: 'Subtotal', key: 'subtotal', money: true },
      { header: 'Descuento', key: 'discount', money: true },
      { header: 'Total', key: 'total', money: true },
      { header: 'Comisión', key: 'commission', money: true },
      { header: 'Neto', key: 'net', money: true },
      { header: 'Estado', key: 'status', width: 14 }
    ],
    sales.map((s) => ({
      folio: s.folio,
      date: s.created_at,
      user: s.user_name ?? '',
      items: s.items,
      method: METHOD_LABELS[s.payment_method] ?? s.payment_method,
      subtotal: pesos(s.subtotal),
      discount: pesos(s.discount),
      total: pesos(s.total),
      commission: pesos(s.card_commission_amount),
      net: pesos(s.net_total),
      status: STATUS_LABELS[s.status] ?? s.status
    }))
  )

  // ── Cortes de caja ──
  addSheet(
    book,
    'Cortes de caja',
    [
      { header: 'Fecha', key: 'day', width: 14 },
      { header: 'Hora', key: 'time', width: 20 },
      { header: 'Fondo inicial', key: 'opening', money: true },
      { header: 'Esperado', key: 'expected', money: true },
      { header: 'Contado', key: 'counted', money: true },
      { header: 'Diferencia', key: 'difference', money: true },
      { header: 'Notas', key: 'notes', width: 34 }
    ],
    (cuts ?? []).map((c) => ({
      day: c.business_date,
      time: c.created_at,
      opening: pesos(c.opening),
      expected: pesos(c.expected_cash),
      counted: pesos(c.counted_cash),
      difference: pesos(c.difference),
      notes: c.notes ?? ''
    }))
  )

  return book
}

/** Nombre sugerido del archivo para el rango dado. */
export const reportFileName = ({ from, to }) =>
  `reporte-${from}${from === to ? '' : `-a-${to}`}.xlsx`

export async function writeReport(data, filePath) {
  await buildWorkbook(data).xlsx.writeFile(filePath)
  return filePath
}
