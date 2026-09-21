import './styles/index.css'
import { hydrateIcons, icon } from './icons.js'
import { initTheme, toggleTheme, currentTheme } from './theme.js'
import { initShortcuts, register, kbd } from './shortcuts/index.js'
import { views } from './views/index.js'
import { showHelp } from './views/help.js'
import { showTicket } from './views/ticket-modal.js'
import { ensureSession, lockScreen } from './views/login.js'
import { allowed, currentUserName, session } from './session.js'
import { initScanner } from './scanner.js'
import { toast } from './components/toast.js'

const $ = (sel) => document.querySelector(sel)

let disposeView = null

// Un cajero no entra a Ajustes: todo lo que hay ahí le está vetado.
const visibleViews = () => views.filter((v) => !v.requires || allowed(v.requires))

function renderNav() {
  $('#nav').innerHTML = visibleViews()
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
  disposeView?.()
  disposeView = null

  document.querySelectorAll('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === id))
  $('#view-title').textContent = view.label
  $('#view-subtitle').textContent = view.subtitle
  try {
    disposeView = await view.render($('#view'))
  } catch (err) {
    console.error(err)
    toast(err.message, 'error')
  }
}

/** Ctrl+P desde cualquier vista. Dentro de Ventas, la propia vista lo reemplaza. */
async function reprintLast() {
  try {
    const sale = await window.api.sales.last()
    if (!sale) return toast('Todavía no hay ventas', 'error')
    await showTicket(sale)
  } catch (err) {
    toast(err.message, 'error')
  }
}

function renderThemeToggle() {
  const dark = currentTheme() === 'dark'
  $('#theme-toggle').innerHTML = `${icon(dark ? 'sun' : 'moon')}<span class="nav-label">${dark ? 'Modo claro' : 'Modo oscuro'}</span>${kbd('Ctrl+D')}`
}

async function start() {
  // Antes que nada, quién está usando la caja: de eso depende qué se muestra.
  await ensureSession()

  const [settings, info] = await Promise.all([window.api.settings.get(), window.api.app.info()])
  initTheme(settings.theme, settings.accent)
  hydrateIcons()
  renderNav()
  renderThemeToggle()
  window.addEventListener('themechange', renderThemeToggle)
  $('#theme-toggle').addEventListener('click', toggleTheme)
  // Con sesión, la cabecera dice quién está vendiendo; sin usuarios no hay nada que
  // poner ahí y el menú empieza directamente, sin un rótulo decorativo.
  const quién = currentUserName()
  if (quién) {
    $('#brand').hidden = false
    $('#brand').innerHTML = `<span class="brand-role"></span><span class="brand-name"></span>`
    $('#brand .brand-role').textContent = session().user?.role === 'admin' ? 'Administrador' : 'Vendedor'
    $('#brand .brand-name').textContent = quién
  }
  $('#version').textContent = `Versión ${info.version}`

  // El bloqueo solo tiene sentido si hay a quién volver a pedirle el PIN.
  if (quién) {
    $('#lock').hidden = false
    $('#lock').innerHTML = `${icon('lock')}<span class="nav-label">Bloquear</span>${kbd('Ctrl+L')}`
    $('#lock').addEventListener('click', lockScreen)
  }

  initShortcuts()
  initScanner()
  // El cajón se abre solo al cobrar en efectivo. Si no responde, el aviso llega aquí:
  // el cobro ya está hecho y el ticket impreso, así que solo hay que enterarse.
  window.api.drawer.onFail((mensaje) => toast(mensaje, 'error'))
  register('F1', showHelp, 'Ayuda: lista de atajos')
  register('Ctrl+D', toggleTheme, 'Alternar modo claro/oscuro')
  register('Ctrl+P', reprintLast, 'Reimprimir último ticket')
  if (quién) register('Ctrl+L', lockScreen, 'Bloquear la caja')
  for (const v of visibleViews()) register(v.keys, () => navigate(v.id), `Ir a ${v.label}`)

  // Vender es lo primero que hace el cajero al abrir la app.
  await navigate('sales')
}

start().catch((err) => {
  console.error(err)
  toast(err.message, 'error')
})
