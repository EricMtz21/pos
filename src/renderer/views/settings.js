import { icon, hydrateIcons } from '../icons.js'
import { kbd, listShortcuts } from '../shortcuts/index.js'
import { toast } from '../components/toast.js'
import { confirmModal } from '../components/modal.js'
import { applyAccent, initTheme } from '../theme.js'
import { createCommissionEditor } from './commission-editor.js'

const escape = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

const ACCENTS = ['#C7F04A', '#4ADE80', '#38BDF8', '#A78BFA', '#FB7185', '#FBBF24']

const formatSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export async function renderSettings(container) {
  const [settings, info, paths, backups] = await Promise.all([
    window.api.settings.get(),
    window.api.app.info(),
    window.api.data.info(),
    window.api.backup.list()
  ])

  let commissionDraft = settings.cardCommission

  container.innerHTML = `
    <div class="settings">
      <section class="panel">
        <h3>${icon('shopping-cart')}Datos del negocio</h3>
        <p class="hint">Aparecen en el encabezado del ticket.</p>
        <form id="s-business" class="form-grid">
          <label class="field full"><span>Nombre *</span>
            <input name="name" value="${escape(settings.business.name)}" required /></label>
          <label class="field full"><span>Dirección</span>
            <input name="address" value="${escape(settings.business.address)}" /></label>
          <label class="field"><span>RFC</span>
            <input name="taxId" value="${escape(settings.business.taxId)}" /></label>
          <label class="field"><span>Teléfono</span>
            <input name="phone" value="${escape(settings.business.phone)}" /></label>
          <label class="field full"><span>Mensaje al pie del ticket</span>
            <input name="footer" value="${escape(settings.business.footer)}" /></label>
          <div class="field full">
            <span>Logo del ticket</span>
            <div class="logo-row">
              <div class="logo-preview" id="s-logo">${settings.business.logo ? '' : 'Sin logo'}</div>
              <button class="btn" type="button" id="s-logo-pick">Elegir imagen…</button>
              <button class="btn ghost danger" type="button" id="s-logo-clear" ${settings.business.logo ? '' : 'disabled'}>Quitar</button>
            </div>
            <span class="hint">PNG, JPG o WEBP, máximo 2 MB. Se imprime arriba del ticket; la vista previa de texto no lo muestra.</span>
          </div>
        </form>
      </section>

      <section class="panel">
        <h3>${icon('credit-card')}Comisiones de tarjeta</h3>
        <div id="s-commission"></div>
      </section>

      <section class="panel">
        <h3>${icon('printer')}Ticket e impresión</h3>
        <form id="s-ticket" class="form-grid">
          <label class="field"><span>Ancho del papel</span>
            <select name="width">
              <option value="58"${settings.ticket.width === 58 ? ' selected' : ''}>58 mm (32 caracteres)</option>
              <option value="80"${settings.ticket.width === 80 ? ' selected' : ''}>80 mm (48 caracteres)</option>
            </select></label>
          <div class="field"><span>Al cobrar</span>
            <label class="switch"><input type="checkbox" name="autoPrint" ${settings.ticket.autoPrint ? 'checked' : ''} />
              <span>Abrir el diálogo de impresión automáticamente</span></label></div>
        </form>
      </section>

      <section class="panel">
        <h3>${icon('sun')}Apariencia</h3>
        <form id="s-appearance" class="form-grid">
          <label class="field"><span>Tema</span>
            <select name="theme">
              <option value="system"${settings.theme === 'system' ? ' selected' : ''}>Seguir al sistema</option>
              <option value="light"${settings.theme === 'light' ? ' selected' : ''}>Claro</option>
              <option value="dark"${settings.theme === 'dark' ? ' selected' : ''}>Oscuro</option>
            </select></label>
          <div class="field"><span>Color de acento</span>
            <div class="accents">
              ${ACCENTS.map(
                (c) => `<button class="accent" type="button" data-accent="${c}" style="--swatch:${c}"
                          aria-pressed="${c.toLowerCase() === settings.accent.toLowerCase()}" aria-label="Acento ${c}"></button>`
              ).join('')}
            </div></div>
        </form>
      </section>

      <section class="panel">
        <h3>${icon('package')}Inventario</h3>
        <form id="s-inventory" class="form-grid">
          <label class="field"><span>Umbral global de stock bajo</span>
            <input name="lowStockThreshold" type="number" step="any" min="0" value="${settings.lowStockThreshold}" />
            <span class="hint">Se usa cuando un producto no tiene su propio mínimo.</span></label>
        </form>
      </section>

      <section class="panel">
        <h3>${icon('keyboard')}Atajos de teclado</h3>
        <p class="hint">Personalizarlos llegará en una versión futura; por ahora son fijos.</p>
        <div class="shortcut-list" id="s-shortcuts"></div>
      </section>

      <section class="panel">
        <h3>${icon('download')}Datos y respaldos</h3>
        <p class="hint">Tu información vive en <code>${escape(paths.dbPath)}</code>, fuera de la aplicación:
          actualizarla no borra nada.</p>
        <div class="button-row">
          <button class="btn" type="button" id="s-backup">${icon('refresh-cw')}Respaldar ahora</button>
          <button class="btn" type="button" id="s-export">${icon('download')}Guardar copia en…</button>
          <button class="btn" type="button" id="s-folder">Abrir carpeta de datos</button>
          <button class="btn danger" type="button" id="s-restore">Restaurar desde un respaldo…</button>
        </div>
        <div class="table-wrap" style="margin-top:14px;max-height:220px">
          <table><thead><tr><th>Respaldo</th><th class="num">Tamaño</th></tr></thead>
          <tbody id="s-backups"></tbody></table>
        </div>
      </section>

      <section class="panel">
        <h3>${icon('info')}Acerca de</h3>
        <div class="about">
          <div><span class="muted">Versión</span><strong>${escape(info.version)}</strong></div>
          <div><span class="muted">Actualizaciones</span><span>Llegarán en una versión futura.</span></div>
        </div>
      </section>
    </div>`
  hydrateIcons(container)

  const $ = (sel) => container.querySelector(sel)

  // ── Guardado ───────────────────────────────────────────────────────────────
  /**
   * Guarda solo lo que cambió de verdad. El autoguardado se dispara al salir de cada
   * campo, así que sin esta comparación una pasada por el formulario escribiría —y
   * avisaría— una vez por campo aunque no se tocara nada.
   */
  async function save(patch) {
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => JSON.stringify(settings[key]) !== JSON.stringify(value))
    )
    if (Object.keys(changed).length === 0) return settings

    try {
      const saved = await window.api.settings.set(changed)
      Object.assign(settings, saved)
      toast('Ajustes guardados')
      return saved
    } catch (err) {
      toast(err.message, 'error')
      return null
    }
  }

  /** Guarda al salir del campo, no en cada tecla: evita una escritura por letra. */
  function autosave(form, build) {
    form.addEventListener('change', () => save(build(form)))
    form.querySelectorAll('input[type="text"], input:not([type])').forEach((input) =>
      input.addEventListener('blur', () => save(build(form)))
    )
  }

  autosave($('#s-business'), (f) => ({
    business: {
      ...settings.business,
      name: f.name.value.trim(),
      address: f.address.value.trim(),
      taxId: f.taxId.value.trim(),
      phone: f.phone.value.trim(),
      footer: f.footer.value.trim()
    }
  }))

  autosave($('#s-ticket'), (f) => ({
    ticket: { ...settings.ticket, width: Number(f.width.value), autoPrint: f.autoPrint.checked }
  }))

  autosave($('#s-inventory'), (f) => ({ lowStockThreshold: Number(f.lowStockThreshold.value) }))

  // ── Apariencia: se aplica en vivo y se guarda ──
  $('#s-appearance').addEventListener('change', async (e) => {
    if (e.target.name !== 'theme') return
    const saved = await save({ theme: e.target.value })
    if (saved) initTheme(saved.theme, saved.accent)
  })

  container.querySelectorAll('[data-accent]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const accent = btn.dataset.accent
      applyAccent(accent) // respuesta inmediata; si falla el guardado, se revierte
      const saved = await save({ accent })
      if (!saved) return applyAccent(settings.accent)
      settings.accent = accent
      container.querySelectorAll('[data-accent]').forEach((b) => b.setAttribute('aria-pressed', b === btn))
    })
  )

  // ── Comisiones ──
  const editor = createCommissionEditor($('#s-commission'), settings.cardCommission, (config) => {
    commissionDraft = config
  })
  // Se guarda al soltar el control, no mientras se teclea un porcentaje a medias.
  $('#s-commission').addEventListener('focusout', () => commissionDraft && save({ cardCommission: commissionDraft }))
  $('#s-commission').addEventListener('change', () => commissionDraft && save({ cardCommission: commissionDraft }))

  // ── Atajos ──
  $('#s-shortcuts').innerHTML = listShortcuts()
    .filter((s) => s.description)
    .map((s) => `<div class="shortcut-row"><span>${escape(s.description)}</span>${kbd(s.combo)}</div>`)
    .join('')

  // ── Logo ──
  function paintLogo(path) {
    const box = $('#s-logo')
    // El renderer no puede leer archivos locales; se muestra el nombre, no la imagen.
    box.textContent = path ? path.split(/[\\/]/).pop() : 'Sin logo'
    box.classList.toggle('has-logo', Boolean(path))
    $('#s-logo-clear').disabled = !path
  }
  paintLogo(settings.business.logo)

  $('#s-logo-pick').addEventListener('click', async () => {
    try {
      const logo = await window.api.data.chooseLogo()
      if (!logo) return
      settings.business.logo = logo
      paintLogo(logo)
      toast('Logo actualizado')
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#s-logo-clear').addEventListener('click', async () => {
    const saved = await save({ business: { ...settings.business, logo: null } })
    if (!saved) return
    settings.business.logo = null
    paintLogo(null)
  })

  // ── Respaldos ──
  function paintBackups(list) {
    $('#s-backups').innerHTML = list.length
      ? list
          .map(
            (b) => `<tr><td>${escape(b.name)}</td><td class="num muted">${formatSize(b.size)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="2" class="muted" style="padding:20px;text-align:center">Todavía no hay respaldos.</td></tr>'
  }
  paintBackups(backups)

  $('#s-backup').addEventListener('click', async () => {
    try {
      await window.api.backup.create()
      paintBackups(await window.api.backup.list())
      toast('Respaldo creado')
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#s-export').addEventListener('click', async () => {
    try {
      const path = await window.api.backup.saveAs()
      if (path) toast(`Copia guardada: ${path}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#s-folder').addEventListener('click', () => window.api.data.openFolder())

  $('#s-restore').addEventListener('click', async () => {
    try {
      const file = await window.api.backup.inspect()
      if (!file) return

      const ok = await confirmModal({
        title: 'Restaurar desde un respaldo',
        message:
          `Se reemplazará toda la información actual por la del respaldo ` +
          `(${file.sales} ventas y ${file.products} productos). Tu base de datos de ahora se guardará ` +
          `como respaldo antes de continuar, y la aplicación se reiniciará.`,
        confirmLabel: 'Restaurar y reiniciar',
        danger: true
      })
      if (!ok) return

      await window.api.backup.restore(file.path)
      toast('Restaurado. Reiniciando…')
      // La base quedó cerrada al sobrescribirla: la app debe arrancar de nuevo.
      await window.api.app.relaunch()
    } catch (err) {
      toast(err.message, 'error')
    }
  })
}
