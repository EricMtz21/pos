// Datos de prueba solo para desarrollo. No corre en producción ni si ya hay productos.
const SAMPLE = [
  { code: '7501055300013', name: 'Agua purificada 1L', cat: 'Bebidas', gross: 1200, net: 1034, cost: 700, stock: 48, tax: 0.16 },
  { code: '7501055300020', name: 'Refresco cola 600ml', cat: 'Bebidas', gross: 1800, net: 1552, cost: 1100, stock: 36, tax: 0.16 },
  { code: '7501000111111', name: 'Galletas surtidas 300g', cat: 'Alimentos', gross: 3200, net: 2759, cost: 2000, stock: 20, tax: 0.16 },
  { code: '7501000222222', name: 'Arroz 1kg', cat: 'Alimentos', gross: 2800, net: 2800, cost: 2100, stock: 3, tax: 0 },
  { code: '7501000333333', name: 'Frijol negro 900g', cat: 'Alimentos', gross: 3500, net: 3500, cost: 2600, stock: 15, tax: 0 },
  { code: '7501000444444', name: 'Detergente líquido 1L', cat: 'Limpieza', gross: 5500, net: 4741, cost: 3800, stock: 12, tax: 0.16 },
  { code: '7501000555555', name: 'Cloro 1L', cat: 'Limpieza', gross: 2200, net: 1897, cost: 1400, stock: 2, tax: 0.16 },
  { code: '7501000666666', name: 'Papel higiénico 4 rollos', cat: 'General', gross: 4200, net: 3621, cost: 2900, stock: 25, tax: 0.16 }
]

export function seedSampleData(repos) {
  if (repos.products.search({ includeInactive: true, limit: 1 }).length > 0) return false
  const cats = Object.fromEntries(repos.categories.list().map((c) => [c.name, c.id]))
  for (const p of SAMPLE) {
    repos.products.create({
      code: p.code, name: p.name, category_id: cats[p.cat], price_gross: p.gross, price_net: p.net,
      cost: p.cost, stock: p.stock, tax_rate: p.tax
    })
  }
  return true
}
