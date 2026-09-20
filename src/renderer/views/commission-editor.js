import { icon, hydrateIcons } from '../icons.js'
import { formatMoney, parseMoney } from '../../shared/money.js'
import { validateTiers } from '../../shared/business/commission.js'

const METHODS = [
  { id: 'credit', label: 'Crédito' },
  { id: 'debit', label: 'Débito' }
]

/**
 * Editor de tramos de comisión (§7): filas {min, pct} por método.
 * `onChange(config)` recibe la configuración completa cada vez que es válida.
 */
export function createCommissionEditor(container, initial, onChange) {
  // Copia de trabajo: no se toca la configuración guardada hasta que valide.
  let config = structuredClone(initial)
  let sameForBoth = JSON.stringify(config.byMethod?.credit?.tiers) === JSON.stringify(config.byMethod?.debit?.tiers)

  const tiersOf = (method) => config.byMethod?.[method]?.tiers ?? [{ min: 0, pct: 0 }]

  function render() {
    const methods = sameForBoth ? [METHODS[0]] : METHODS
    container.innerHTML = `
      <div class="setting-row">
        <label class="switch">
          <input type="checkbox" id="c-enabled" ${config.enabled ? 'checked' : ''} />
          <span>Descontar la comisión de tarjeta</span>
        </label>
        <p class="hint">Solo afecta lo que recibe el negocio. El cliente siempre paga el total.</p>
      </div>

      <div class="commission-body ${config.enabled ? '' : 'disabled'}">
        <div class="form-grid">
          <label class="field">
            <span>El volumen se acumula por</span>
            <select id="c-period">
              <option value="daily"${config.period === 'daily' ? ' selected' : ''}>Día</option>
              <option value="weekly"${config.period === 'weekly' ? ' selected' : ''}>Semana</option>
              <option value="monthly"${config.period === 'monthly' ? ' selected' : ''}>Mes natural</option>
            </select>
            <span class="hint">Al cambiar de periodo, el acumulado vuelve a cero.</span>
          </label>
          <div class="field">
            <span>Opciones</span>
            <label class="switch">
              <input type="checkbox" id="c-iva" ${config.applyIvaOnCommission ? 'checked' : ''} />
              <span>El proveedor cobra IVA sobre la comisión</span>
            </label>
            <label class="switch">
              <input type="checkbox" id="c-same" ${sameForBoth ? 'checked' : ''} />
              <span>Misma tasa para débito y crédito</span>
            </label>
          </div>
        </div>

        ${methods
          .map(
            (m) => `<div class="tier-block" data-method="${m.id}">
              <h4>${sameForBoth ? 'Tramos' : `Tramos · ${m.label}`}</h4>
              <table class="tiers">
                <thead><tr><th>Desde un acumulado de</th><th class="num">Comisión</th><th></th></tr></thead>
                <tbody>
                  ${tiersOf(m.id)
                    .map(
                      (t, i) => `<tr>
                        <td>${
                          i === 0
                            ? '<span class="muted">Desde el primer peso</span>'
                            : `<input data-field="min" data-i="${i}" inputmode="decimal" value="${(t.min / 100).toFixed(2)}" />`
                        }</td>
                        <td class="num"><div class="pct"><input data-field="pct" data-i="${i}" inputmode="decimal" value="${t.pct}" /><span>%</span></div></td>
                        <td>${
                          i === 0
                            ? ''
                            : `<button class="btn ghost icon-only danger" data-remove="${i}" aria-label="Quitar tramo">${icon('trash-2')}</button>`
                        }</td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
              <button class="btn" type="button" data-add>${icon('plus')}Agregar tramo</button>
            </div>`
          )
          .join('')}

        <p class="errors" id="c-errors"></p>
        <p class="hint" id="c-example"></p>
      </div>`
    hydrateIcons(container)
    bind()
    validate()
  }

  /** Mantiene débito y crédito sincronizados cuando se eligió una sola tasa. */
  function setTiers(method, tiers) {
    config.byMethod ??= {}
    const targets = sameForBoth ? ['credit', 'debit'] : [method]
    for (const m of targets) config.byMethod[m] = { tiers: structuredClone(tiers) }
  }

  function validate() {
    const errors = config.enabled
      ? [...new Set(METHODS.flatMap((m) => validateTiers(tiersOf(m.id))))]
      : []
    const box = container.querySelector('#c-errors')
    const example = container.querySelector('#c-example')
    if (box) box.textContent = errors.join(' · ')

    if (example) {
      const tiers = tiersOf('credit')
      example.textContent =
        !config.enabled || errors.length > 0
          ? ''
          : `Ejemplo: una venta de ${formatMoney(100000)} con un acumulado de ${formatMoney(tiers.at(-1).min)} pagaría ${formatMoney(Math.round((100000 * tiers.at(-1).pct) / 100))} de comisión.`
    }

    onChange(errors.length === 0 ? structuredClone(config) : null)
    return errors.length === 0
  }

  function bind() {
    const $ = (sel) => container.querySelector(sel)

    $('#c-enabled')?.addEventListener('change', (e) => {
      config.enabled = e.target.checked
      render()
    })
    $('#c-period')?.addEventListener('change', (e) => {
      config.period = e.target.value
      validate()
    })
    $('#c-iva')?.addEventListener('change', (e) => {
      config.applyIvaOnCommission = e.target.checked
      validate()
    })
    $('#c-same')?.addEventListener('change', (e) => {
      sameForBoth = e.target.checked
      // Al unificar, manda la tabla de crédito para no dejar las dos a medias.
      if (sameForBoth) setTiers('credit', tiersOf('credit'))
      render()
    })

    container.querySelectorAll('.tier-block').forEach((block) => {
      const method = block.dataset.method

      // Al salir del campo se normaliza a dos decimales: si no, quedan «1000» y
      // «200000.00» uno junto al otro y no se lee que ambos son pesos.
      block.querySelectorAll('input[data-field="min"]').forEach((input) =>
        input.addEventListener('blur', () => {
          const cents = parseMoney(input.value)
          if (cents !== null) input.value = (cents / 100).toFixed(2)
        })
      )

      block.querySelectorAll('input[data-field]').forEach((input) =>
        input.addEventListener('input', () => {
          const tiers = structuredClone(tiersOf(method))
          const i = Number(input.dataset.i)
          if (input.dataset.field === 'min') {
            const cents = parseMoney(input.value)
            input.setAttribute('aria-invalid', cents === null)
            tiers[i].min = cents ?? 0
          } else {
            const pct = Number(input.value)
            input.setAttribute('aria-invalid', !(pct >= 0 && pct <= 100))
            tiers[i].pct = Number.isFinite(pct) ? pct : 0
          }
          setTiers(method, tiers)
          validate()
        })
      )

      block.querySelector('[data-add]')?.addEventListener('click', () => {
        const tiers = structuredClone(tiersOf(method))
        const last = tiers.at(-1)
        // El tramo nuevo arranca por encima del anterior, así nace válido.
        tiers.push({ min: last.min + 10000000, pct: Math.max(0, last.pct - 1) })
        setTiers(method, tiers)
        render()
      })

      block.querySelectorAll('[data-remove]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const tiers = structuredClone(tiersOf(method))
          tiers.splice(Number(btn.dataset.remove), 1)
          setTiers(method, tiers)
          render()
        })
      )
    })
  }

  render()
  return {
    get value() {
      return structuredClone(config)
    },
    isValid: validate
  }
}
