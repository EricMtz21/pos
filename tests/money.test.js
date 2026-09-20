import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toCents, parseMoney, netFromGross, margin, formatMoney } from '../src/shared/money.js'

test('toCents redondea sin errores de coma flotante', () => {
  assert.equal(toCents(18.0), 1800)
  assert.equal(toCents(0.1 + 0.2), 30) // 0.30000000000000004
  assert.equal(toCents(1234.565), 123457)
})

test('parseMoney acepta lo que teclea el usuario y rechaza basura', () => {
  assert.equal(parseMoney('18'), 1800)
  assert.equal(parseMoney('$1,234.50'), 123450)
  assert.equal(parseMoney(' 18.99 '), 1899)
  assert.equal(parseMoney(''), 0)
  assert.equal(parseMoney('abc'), null)
  assert.equal(parseMoney('-5'), null)
})

test('netFromGross: el IVA va incluido en el precio al público', () => {
  assert.equal(netFromGross(1800, 0.16), 1552)
  assert.equal(netFromGross(2800, 0), 2800)
  // El neto reconstruye el bruto con menos de un centavo de error.
  for (const gross of [1, 999, 1800, 123456]) {
    assert.ok(Math.abs(netFromGross(gross, 0.16) * 1.16 - gross) < 1)
  }
})

test('margin sobre el precio sin IVA', () => {
  assert.equal(margin(2000, 1000), 50)
  assert.equal(margin(1552, 1100).toFixed(1), '29.1')
  assert.equal(margin(2000, 0), null)
  assert.equal(margin(0, 500), null)
})

test('formatMoney usa pesos mexicanos', () => {
  assert.match(formatMoney(123450), /1,234\.50/)
})
