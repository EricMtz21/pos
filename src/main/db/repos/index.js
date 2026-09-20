import { createAuditRepo } from './audit.js'
import { createSettingsRepo } from './settings.js'
import { createCategoriesRepo } from './categories.js'
import { createProductsRepo } from './products.js'
import { createSalesRepo } from './sales.js'
import { createReportsRepo } from './reports.js'
import { createCashCutsRepo } from './cash-cuts.js'

export function createRepos(db) {
  const audit = createAuditRepo(db)
  const settings = createSettingsRepo(db)
  const categories = createCategoriesRepo(db)
  const products = createProductsRepo(db, { settings, audit })
  const sales = createSalesRepo(db, { settings, products, audit })
  const reports = createReportsRepo(db)
  const cashCuts = createCashCutsRepo(db, { audit })
  return { audit, settings, categories, products, sales, reports, cashCuts }
}
