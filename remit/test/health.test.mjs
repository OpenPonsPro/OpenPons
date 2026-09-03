import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkFreshness, checkGas, overall, statusCode, report,
  STALE_WARN_MS, STALE_CRIT_MS, GAS_WARN_WEI, GAS_CRIT_WEI,
  decideNotify, alertBody, RENOTIFY_MS,
} from '../src/health.ts'

const NOW = 1_800_000_000_000
const base = { sinceLastRunMs: 60_000, keeperGasWei: 100_000_000_000_000_000n }

test('⚠ an unreachable chain is unknown, never a fault', () => {
  assert.equal(checkGas({ ...base, keeperGasWei: null }).level, 'unknown')
  assert.equal(checkFreshness({ ...base, sinceLastRunMs: null }).level, 'unknown')
})

test('one long pass is normal; three missed ones are not', () => {
  assert.equal(checkFreshness({ ...base, sinceLastRunMs: 20 * 60_000 }).level, 'ok')
  assert.equal(checkFreshness({ ...base, sinceLastRunMs: STALE_WARN_MS }).level, 'warn')
  assert.equal(checkFreshness({ ...base, sinceLastRunMs: STALE_CRIT_MS }).level, 'critical')
})

test('gas warns before it is urgent, and is critical before it is empty', () => {
  assert.equal(checkGas({ ...base, keeperGasWei: GAS_WARN_WEI }).level, 'ok')
  assert.equal(checkGas({ ...base, keeperGasWei: GAS_WARN_WEI - 1n }).level, 'warn')
  assert.equal(checkGas({ ...base, keeperGasWei: GAS_CRIT_WEI - 1n }).level, 'critical')
  /* ⛔ Never waits for zero: at zero the keeper stops with no error anywhere. */
  assert.equal(checkGas({ ...base, keeperGasWei: 0n }).level, 'critical')
})

test('the worst check decides the whole, and unknown does not mask a fault', () => {
  assert.equal(overall([{ id: 'a', level: 'ok', detail: '' }, { id: 'b', level: 'unknown', detail: '' }]), 'unknown')
  assert.equal(overall([{ id: 'a', level: 'unknown', detail: '' }, { id: 'b', level: 'critical', detail: '' }]), 'critical')
  assert.equal(overall([{ id: 'a', level: 'warn', detail: '' }, { id: 'b', level: 'critical', detail: '' }]), 'critical')
})

test('⚠ unknown answers 200, so a rate limited RPC does not page anybody', () => {
  assert.equal(statusCode('unknown'), 200)
  assert.equal(statusCode('ok'), 200)
  assert.equal(statusCode('warn'), 503)
  assert.equal(statusCode('critical'), 503)
})

test('a healthy system reports 200 and says why for each check', () => {
  const r = report(base, NOW)
  assert.equal(r.level, 'ok')
  assert.equal(r.code, 200)
  assert.equal(r.checks.length, 2)
  for (const c of r.checks) assert.ok(c.detail.length > 0, `${c.id} gave no detail`)
})

test('⛔⛔ the same fault is not re-sent every five minutes', () => {
  /* Twelve messages an hour for one fault mutes the channel, which is worse than no alerting
     because it looks like coverage. */
  const prev = { level: 'critical', atMs: NOW }
  assert.equal(decideNotify('critical', prev, NOW + 5 * 60_000).send, false)
  assert.equal(decideNotify('critical', prev, NOW + 30 * 60_000).send, false)
})

test('an unresolved fault is repeated once an hour', () => {
  const prev = { level: 'critical', atMs: NOW }
  const d = decideNotify('critical', prev, NOW + RENOTIFY_MS)
  assert.equal(d.send, true)
  assert.equal(d.kind, 'reminder')
})

test('a new fault is sent immediately', () => {
  const d = decideNotify('critical', null, NOW)
  assert.equal(d.send, true)
  assert.equal(d.kind, 'raised')
})

test('an escalation is sent even inside the quiet window', () => {
  /* warn -> critical matters more than not repeating yourself. */
  const d = decideNotify('critical', { level: 'warn', atMs: NOW }, NOW + 60_000)
  assert.equal(d.send, true)
  assert.equal(d.kind, 'worsened')
})

test('recovery is announced once, and only once', () => {
  const rec = decideNotify('ok', { level: 'critical', atMs: NOW }, NOW + 60_000)
  assert.equal(rec.send, true)
  assert.equal(rec.kind, 'recovered')
  assert.equal(decideNotify('ok', { level: 'ok', atMs: NOW }, NOW + 60_000).send, false)
})

test('⚠ `unknown` never announces a recovery', () => {
  /* A rate limited RPC would otherwise send "recovered" while the fault was merely unobservable. */
  const d = decideNotify('unknown', { level: 'critical', atMs: NOW }, NOW + 60_000)
  assert.equal(d.send, false)
})

test('⚠ `unknown` never raises an alert either', () => {
  assert.equal(decideNotify('unknown', null, NOW).send, false)
})

test('a healthy system with no history sends nothing', () => {
  assert.equal(decideNotify('ok', null, NOW).send, false)
})

test('the body carries both Discord and Slack keys, so one URL works either way', () => {
  const b = alertBody('critical', 'raised', [{ id: 'gas', level: 'critical', detail: 'nearly empty' }], 'https://x')
  assert.equal(b.content, b.text)
  assert.match(b.content, /gas: nearly empty/)
  assert.match(b.content, /CRITICAL/)
})

test('a recovery message lists the checks rather than only the failing ones', () => {
  const b = alertBody('ok', 'recovered', [{ id: 'gas', level: 'ok', detail: '0.05 ETH' }], 'https://x')
  assert.match(b.content, /recovered/)
  assert.match(b.content, /0.05 ETH/)
})
