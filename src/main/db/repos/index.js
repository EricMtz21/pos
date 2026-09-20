import { createAuditRepo } from './audit.js'
import { createSettingsRepo } from './settings.js'
import { createCategoriesRepo } from './categories.js'
import { createProductsRepo } from './products.js'
import { createSalesRepo } from './sales.js'
import { createReportsRepo } from './reports.js'
import { createCashCutsRepo } from './cash-cuts.js'
import { createReturnsRepo } from './returns.js'
import { createUsersRepo } from './users.js'

export function createRepos(db) {
  const audit = createAuditRepo(db)
  const settings = createSettingsRepo(db)
  const categories = createCategoriesRepo(db)
  const products = createProductsRepo(db, { settings, audit })
  const sales = createSalesRepo(db, { settings, products, audit })
  const returns = createReturnsRepo(db, { audit })
  const reports = createReportsRepo(db, { returns })
  const cashCuts = createCashCutsRepo(db, { audit })
  const users = createUsersRepo(db, { audit })
  return { audit, settings, categories, products, sales, returns, reports, cashCuts, users }
}
