import './styles/index.css'
import { hydrateIcons, icon } from './icons.js'
import { initTheme, toggleTheme, currentTheme } from './theme.js'
import { initShortcuts, register, kbd } from './shortcuts/index.js'
import { views, renderPlaceholder } from './views/index.js'
import { toast } from './components/toast.js'

const $ = (sel) => document.querySelector(sel)

function renderNav() {
  $('#nav').innerHTML = views
    .map(
      (v) => `<button class="nav-item" type="button" data-view="${v.id}">
        ${icon(v.icon)}<span class="nav-label">${v.label}</span>${kbd(v.keys)}
      </button>`
    )
    .join('')
  $('#nav').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]')
    if (btn) navigate(btn.dataset.view)
  })
}

async function navigate(id) {
  const view = views.find((v) => v.id === id)
  document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === id))
  $('#view-title').textContent = view.label
  $('#view-subtitle').textContent = view.subtitle
  try {
    await renderPlaceholder(view, $('#view'))
  } catch (err) {
    toast(err.message, 'error')
  }
}

function renderThemeToggle() {
  const dark = currentTheme() === 'dark'
  $('#theme-toggle').innerHTML = `${icon(dark ? 'sun' : 'moon')}<span class="nav-label">${dark ? 'Modo claro' : 'Modo oscuro'}</span>${kbd('Ctrl+D')}`
}

async function start() {
  const [settings, info] = await Promise.all([window.api.settings.get(), window.api.app.info()])
  initTheme(settings.theme, settings.accent)
  hydrateIcons()
  renderNav()
  renderThemeToggle()
  window.addEventListener('themechange', renderThemeToggle)
  $('#theme-toggle').addEventListener('click', toggleTheme)
  $('#version').textContent = `Versión ${info.version}`

  initShortcuts()
  register('Ctrl+D', toggleTheme, 'Alternar modo claro/oscuro')
  for (const v of views) register(v.keys, () => navigate(v.id), `Ir a ${v.label}`)

  navigate('sales')
}

start().catch((err) => {
  console.error(err)
  toast(err.message, 'error')
})
