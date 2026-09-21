import { icon, hydrateIcons } from '../icons.js'
import { kbd, listShortcuts } from '../shortcuts/index.js'
import { toast } from '../components/toast.js'
import { confirmModal, openModal } from '../components/modal.js'
import { applyAccent, initTheme } from '../theme.js'
import { session } from '../session.js'
import { createCommissionEditor } from './commission-editor.js'

const escape = (s) =>
  String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])

const ACCENTS = ['#3B82F6', '#0EA5E9', '#14B8A6', '#8B5CF6', '#F43F5E', '#F59E0B']

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
            </select>
            <span class="hint">Tiene que coincidir con el rollo que carga la impresora, o el
              ticket saldrá cortado o angosto.</span></label>
          <label class="field"><span>Impresora</span>
            <select name="printer" id="s-printer"><option value="">Cargando…</option></select>
            <span class="hint">Con una impresora elegida el ticket sale directo. Sin elegir,
              se abre el diálogo de Windows en cada venta.</span></label>
        </form>

        <div class="button-row" style="margin-top:14px">
          <button class="btn" type="button" id="s-test-print">${icon('printer')}Imprimir ticket de prueba</button>
        </div>

        <div class="setting-row" style="margin-top:18px">
          <label class="switch">
            <input type="checkbox" id="s-drawer-enabled" ${settings.cashDrawer.enabled ? ' checked' : ''} />
            <span>Abrir el cajón al cobrar en efectivo</span>
          </label>
          <p class="hint">El cajón no se conecta a la computadora: cuelga de la impresora por un
            cable telefónico, y se abre con un pulso que se manda a través de ella.</p>
        </div>

        <div class="drawer-body ${settings.cashDrawer.enabled ? '' : 'disabled'}" id="s-drawer-body">
          <form class="form-grid" id="s-drawer">
            <label class="field"><span>El cajón cuelga de</span>
              <select name="target" id="s-drawer-target"><option value="">Cargando…</option></select>
              <span class="hint">Normalmente la misma impresora del ticket. Con la impresora
                conectada por cable serie o paralelo, elige el puerto.</span></label>
            <label class="field"><span>Patilla del conector</span>
              <select name="pin">
                <option value="0"${settings.cashDrawer.pin === 0 ? ' selected' : ''}>2 (lo habitual)</option>
                <option value="1"${settings.cashDrawer.pin === 1 ? ' selected' : ''}>5</option>
              </select>
              <span class="hint">Si el cajón no responde con una, prueba la otra: depende del
                fabricante.</span></label>
          </form>
          <div class="button-row" style="margin-top:14px">
            <button class="btn" type="button" id="s-test-drawer">${icon('wallet')}Probar el cajón</button>
          </div>
        </div>

        <div class="field" style="margin-top:18px">
          <span>Vista previa</span>
          <div class="ticket-paper ticket-preview"><pre id="s-ticket-preview"></pre></div>
          <span class="hint">Datos de ejemplo. Refleja el nombre, RFC y mensaje del negocio, y el
            ancho elegido. El logo no aparece aquí: solo se ve al imprimir o guardar en PDF.</span>
        </div>
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
        <h3>${icon('keyboard')}Usuarios y roles</h3>
        <p class="hint">Mientras no haya usuarios, la aplicación abre sin PIN y permite todo.
          Al crear el primero, se pedirá PIN al arrancar.</p>
        <div class="table-wrap" style="max-height:220px">
          <table><thead><tr><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
          <tbody id="s-users"></tbody></table>
        </div>
        <div class="button-row" style="margin-top:12px">
          <button class="btn primary" type="button" id="s-user-new">${icon('plus')}Nuevo usuario</button>
          <button class="btn" type="button" id="s-logout">Cerrar sesión</button>
        </div>
      </section>

      <section class="panel">
        <h3>${icon('refresh-cw')}Actualizaciones</h3>
        <p class="hint">Buscar actualizaciones necesita internet. Vender no: el punto de venta
          funciona igual sin conexión, y actualizar nunca borra tu información.</p>
        <div class="about">
          <div><span class="muted">Versión instalada</span><strong>${escape(info.version)}</strong></div>
        </div>
        <p id="u-message" class="hint" style="margin-top:10px"></p>
        <div class="update-progress" id="u-progress" hidden><div id="u-bar"></div></div>
        <div class="button-row" style="margin-top:12px">
          <button class="btn primary" type="button" id="u-check">${icon('refresh-cw')}Buscar actualizaciones</button>
          <button class="btn" type="button" id="u-download" hidden>${icon('download')}Descargar</button>
          <button class="btn primary" type="button" id="u-install" hidden>${icon('check')}Reiniciar e instalar</button>
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
  async function paintTicketPreview() {
    try {
      // textContent: el ticket es texto plano, nunca HTML.
      $('#s-ticket-preview').textContent = (await window.api.ticket.previewSample()).join('\n')
    } catch (err) {
      $('#s-ticket-preview').textContent = `No se pudo generar la vista previa: ${err.message}`
    }
  }

  async function save(patch) {
    const changed = Object.fromEntries(
      Object.entries(patch).filter(([key, value]) => JSON.stringify(settings[key]) !== JSON.stringify(value))
    )
    if (Object.keys(changed).length === 0) return settings

    try {
      const saved = await window.api.settings.set(changed)
      Object.assign(settings, saved)
      toast('Ajustes guardados')
      // El negocio y el ancho salen en el ticket: la vista previa debe seguirlos.
      if ('business' in changed || 'ticket' in changed) await paintTicketPreview()
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
    ticket: { ...settings.ticket, width: Number(f.width.value), printer: f.printer.value }
  }))

  autosave($('#s-inventory'), (f) => ({ lowStockThreshold: Number(f.lowStockThreshold.value) }))

  await paintTicketPreview()

  // ── Impresora: se listan las del sistema ──
  let impresoras = []
  try {
    impresoras = await window.api.data.printers()
    $('#s-printer').innerHTML =
      `<option value="">Preguntar en cada venta</option>` +
      impresoras
        .map(
          (i) => `<option value="${escape(i.name)}"${i.name === settings.ticket.printer ? ' selected' : ''}>
            ${escape(i.name)}${i.default ? ' (predeterminada)' : ''}</option>`
        )
        .join('')
  } catch (err) {
    $('#s-printer').innerHTML = `<option value="">No se pudieron listar las impresoras</option>`
    console.error(err)
  }

  // ── Cajón de dinero ──
  // Se ofrecen las impresoras y, además, los puertos: una impresora vieja conectada por
  // serie o paralelo no aparece en la lista del sistema y aun así abre el cajón.
  const PUERTOS = ['COM1', 'COM2', 'COM3', 'COM4', 'LPT1']
  function pintarDestinosCajon(impresoras) {
    const actual = settings.cashDrawer.target
    const opcion = (valor, texto) => `<option value="${escape(valor)}"${valor === actual ? ' selected' : ''}>${escape(texto)}</option>`
    $('#s-drawer-target').innerHTML =
      opcion('', 'La impresora del ticket') +
      impresoras.map((i) => opcion(i.name, i.name)).join('') +
      PUERTOS.map((p) => opcion(p, `Puerto ${p}`)).join('')
  }

  pintarDestinosCajon(impresoras)

  const guardarCajon = () => {
    const f = $('#s-drawer')
    return save({
      cashDrawer: { enabled: $('#s-drawer-enabled').checked, target: f.target.value, pin: Number(f.pin.value) }
    })
  }

  $('#s-drawer-enabled').addEventListener('change', () => {
    $('#s-drawer-body').classList.toggle('disabled', !$('#s-drawer-enabled').checked)
    guardarCajon()
  })
  $('#s-drawer').addEventListener('change', guardarCajon)

  $('#s-test-drawer').addEventListener('click', async () => {
    const boton = $('#s-test-drawer')
    boton.disabled = true
    try {
      // Se guarda primero: probar lo que hay en pantalla y no lo guardado sería probar otra cosa.
      await guardarCajon()
      await window.api.drawer.open()
      toast('Pulso enviado: el cajón debería haberse abierto')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      boton.disabled = false
    }
  })

  $('#s-test-print').addEventListener('click', async () => {
    const boton = $('#s-test-print')
    boton.disabled = true
    try {
      if (await window.api.ticket.printSample()) toast('Ticket de prueba enviado')
    } catch (err) {
      toast(err.message, 'error')
    } finally {
      boton.disabled = false
    }
  })

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

  // ── Usuarios ──
  async function paintUsers() {
    const list = await window.api.users.list()
    const actual = session().user
    $('#s-users').innerHTML = list.length
      ? list
          .map(
            (u) => `<tr data-user="${u.id}" class="${u.active ? '' : 'cancelled'}">
              <td>${escape(u.name)}${u.id === actual?.id ? ' <span class="badge">tú</span>' : ''}</td>
              <td class="muted">${u.role === 'admin' ? 'Administrador' : 'Cajero'}</td>
              <td class="muted">${u.active ? 'Activo' : 'Inactivo'}</td>
              <td><div class="row-actions">
                <button class="btn ghost icon-only" data-act="edit" aria-label="Editar">${icon('pencil')}</button>
                ${u.active ? `<button class="btn ghost icon-only danger" data-act="off" aria-label="Desactivar">${icon('trash-2')}</button>` : ''}
              </div></td>
            </tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="muted" style="padding:20px;text-align:center">Sin usuarios: la aplicación abre sin PIN.</td></tr>'
    hydrateIcons($('#s-users'))
    $('#s-logout').disabled = !actual
  }
  await paintUsers()

  $('#s-user-new').addEventListener('click', async () => {
    const datos = await openUserForm(null)
    if (!datos) return
    try {
      await window.api.users.create(datos)
      await paintUsers()
      toast(`Usuario creado: ${datos.name}`)
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#s-users').addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act
    if (!act) return
    const id = Number(e.target.closest('[data-user]').dataset.user)
    const user = (await window.api.users.list()).find((u) => u.id === id)

    try {
      if (act === 'edit') {
        const datos = await openUserForm(user)
        if (!datos) return
        await window.api.users.update(id, datos)
        toast('Usuario actualizado')
      } else {
        const ok = await confirmModal({
          title: 'Desactivar usuario',
          message: `«${user.name}» dejará de poder entrar. Sus ventas y movimientos se conservan.`,
          confirmLabel: 'Desactivar',
          danger: true
        })
        if (!ok) return
        await window.api.users.deactivate(id)
        toast('Usuario desactivado')
      }
      await paintUsers()
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  $('#s-logout').addEventListener('click', async () => {
    await window.api.auth.logout()
    location.reload() // vuelve a arrancar y pide PIN
  })

  // ── Actualizaciones ──
  function paintUpdate(state) {
    $('#u-message').textContent = state.message ?? ''
    $('#u-check').disabled = ['checking', 'downloading'].includes(state.status)
    $('#u-download').hidden = state.status !== 'available'
    $('#u-install').hidden = state.status !== 'ready'

    const bajando = state.status === 'downloading'
    $('#u-progress').hidden = !bajando
    if (bajando) $('#u-bar').style.width = `${state.percent}%`
  }
  paintUpdate(await window.api.updates.state())

  // El progreso llega por evento desde el proceso principal.
  const unsubscribe = window.api.updates.onState(paintUpdate)

  $('#u-check').addEventListener('click', async () => {
    paintUpdate(await window.api.updates.check())
  })
  $('#u-download').addEventListener('click', async () => {
    paintUpdate(await window.api.updates.download())
  })
  $('#u-install').addEventListener('click', async () => {
    try {
      await window.api.updates.install()
    } catch (err) {
      toast(err.message, 'error')
    }
  })

  // Al salir de Ajustes se suelta el listener: si no, se apilaría uno por visita.
  return () => unsubscribe()
}

/** Alta o edición de usuario. `user` null = alta. Devuelve los datos o null. */
function openUserForm(user) {
  const editing = Boolean(user)
  return openModal({
    title: editing ? `Editar · ${user.name}` : 'Nuevo usuario',
    body: `
      <form id="user-form" class="form-grid">
        <label class="field full"><span>Nombre *</span>
          <input name="name" value="${escape(user?.name ?? '')}" autocomplete="off" required /></label>
        <label class="field"><span>Rol</span>
          <select name="role">
            <option value="cashier"${user?.role === 'cashier' ? ' selected' : ''}>Cajero</option>
            <option value="admin"${user?.role === 'admin' ? ' selected' : ''}>Administrador</option>
          </select>
          <span class="hint">El cajero vende y hace cortes, pero no cambia precios ni ajustes.</span></label>
        <label class="field"><span>PIN ${editing ? '(dejar vacío para no cambiarlo)' : '*'}</span>
          <input name="pin" inputmode="numeric" autocomplete="off" placeholder="4 a 8 dígitos" /></label>
      </form>`,
    footer: `<button class="btn" type="button" data-close>Cancelar</button>
             <button class="btn primary" type="submit" form="user-form">Guardar</button>`,
    onMount: ({ dialog, close }) => {
      const form = dialog.querySelector('#user-form')
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const pin = form.pin.value.trim()
        if (!editing && !/^\d{4,8}$/.test(pin)) return form.pin.setAttribute('aria-invalid', 'true')
        if (editing && pin && !/^\d{4,8}$/.test(pin)) return form.pin.setAttribute('aria-invalid', 'true')
        close({
          name: form.name.value.trim(),
          role: form.role.value,
          ...(pin ? { pin } : {})
        })
      })
      form.name.focus()
    }
  })
}
