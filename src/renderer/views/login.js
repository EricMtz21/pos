import { refreshSession } from '../session.js'

/**
 * Pantalla de acceso con PIN. Se muestra a pantalla completa y solo se cierra
 * cuando alguien entra: sin sesión no hay nada que hacer en la aplicación.
 * Resuelve con el estado de sesión ya actualizado.
 */
export async function showLogin() {
  const users = await window.api.auth.users()
  let selected = users[0] ?? null
  let pin = ''

  const overlay = document.createElement('div')
  overlay.className = 'login'
  overlay.innerHTML = `
    <div class="login-card">
      <div class="brand">
        <span class="brand-name">Punto de Venta</span>
      </div>
      <p class="hint">Elige tu usuario e introduce tu PIN.</p>

      <div class="login-users" id="l-users">
        ${users
          .map(
            (u) => `<button class="login-user" type="button" data-id="${u.id}" aria-pressed="${u.id === selected?.id}">
              <strong>${u.name.replace(/[<>&]/g, '')}</strong>
              <span class="muted">${u.role === 'admin' ? 'Administrador' : 'Cajero'}</span>
            </button>`
          )
          .join('')}
      </div>

      <div class="pin-display" id="l-pin" aria-live="polite"></div>
      <p class="errors" id="l-error"></p>

      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="btn" type="button" data-key="${n}">${n}</button>`).join('')}
        <button class="btn ghost" type="button" data-key="back">Borrar</button>
        <button class="btn" type="button" data-key="0">0</button>
        <button class="btn primary" type="button" data-key="enter">Entrar</button>
      </div>
    </div>`
  document.body.append(overlay)

  const $ = (sel) => overlay.querySelector(sel)

  const paintPin = () => {
    $('#l-pin').textContent = '•'.repeat(pin.length).padEnd(4, '·')
  }
  paintPin()

  return new Promise((resolve) => {
    const fail = (message) => {
      $('#l-error').textContent = message
      pin = ''
      paintPin()
    }

    async function submit() {
      if (!selected) return fail('Elige un usuario')
      if (pin.length < 4) return fail('El PIN tiene al menos 4 dígitos')
      try {
        const state = await window.api.auth.login(selected.id, pin)
        overlay.remove()
        window.removeEventListener('keydown', onKey, true)
        resolve(state)
      } catch (err) {
        fail(err.message)
      }
    }

    const type = (digit) => {
      if (pin.length >= 8) return
      pin += digit
      $('#l-error').textContent = ''
      paintPin()
    }

    $('#l-users').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]')
      if (!btn) return
      selected = users.find((u) => u.id === Number(btn.dataset.id))
      overlay.querySelectorAll('[data-id]').forEach((b) => b.setAttribute('aria-pressed', b === btn))
      pin = ''
      $('#l-error').textContent = ''
      paintPin()
    })

    overlay.querySelector('.pin-pad').addEventListener('click', (e) => {
      const key = e.target.closest('[data-key]')?.dataset.key
      if (!key) return
      if (key === 'enter') return submit()
      if (key === 'back') {
        pin = pin.slice(0, -1)
        return paintPin()
      }
      type(key)
    })

    // Se puede teclear directamente: es más rápido que apuntar al teclado en pantalla.
    function onKey(e) {
      if (/^\d$/.test(e.key)) {
        e.preventDefault()
        return type(e.key)
      }
      if (e.key === 'Backspace') {
        e.preventDefault()
        pin = pin.slice(0, -1)
        return paintPin()
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey, true)
  })
}

/** Refresca la sesión y muestra el acceso si hace falta. */
export async function ensureSession() {
  const state = await refreshSession()
  if (state.required && !state.user) return showLogin()
  return state
}
