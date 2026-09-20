import { createAuditRepo } from './audit.js'
import { createSettingsRepo } from './settings.js'
import { createCategoriesRepo } from './categories.js'
import { createProductsRepo } from './products.js'
import { createSalesRepo } from './sales.js'

export function createRepos(db) {
  const audit = createAuditRepo(db)
  const settings = createSettingsRepo(db)
  const categories = createCategoriesRepo(db)
  const products = createProductsRepo(db, { settings, audit })
  const sales = createSalesRepo(db, { settings, products, audit })
  return { audit, settings, categories, products, sales }
}
