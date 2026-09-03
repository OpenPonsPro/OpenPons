import { test } from 'node:test'
import assert from 'node:assert/strict'
import { launcherShare, launchesBy, claimableFor, worthCranking, totalsByAsset } from '../src/lib/claimable.ts'

const ME = '0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa'
const OTHER = '0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb'
const ETH = '0x0000000000000000000000000000000000000000'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const L = (o = {}) => ({
  token: '0x' + '11'.repeat(20), creator: ME, projectBps: 10000, launchedAt: 100n,
  pairToken: ETH, pairSymbol: 'ETH', pairDecimals: 18, ...o,
})

/* ── the split, exactly as the contract computes it ──────────────────────────────────────── */

test('⛔ a 100% project split pays the launcher nothing, however much it trades', () => {
  assert.equal(launcherShare(10n ** 18n, 10000), 0n)
})

test('the launcher gets the remainder at a partial split', () => {
  assert.equal(launcherShare(1000n, 9000), 100n, '10% of the fee')
  assert.equal(launcherShare(1000n, 5000), 500n)
})

test('⛔ dust rounds to the PROJECT, matching _release, so the page never over promises', () => {
  // contract: toOps = amount * (10000 - bps) / 10000, remainder to project
  assert.equal(launcherShare(9999n, 9999n === 0n ? 0 : 9999), 0n, 'rounds down, never up')
  assert.equal(launcherShare(3n, 5000), 1n, '1.5 becomes 1 for ops, project keeps 2')
})

test('a nonsense split cannot produce a share above the amount', () => {
  assert.equal(launcherShare(500n, -5), 500n)
  assert.equal(launcherShare(500n, 99999), 0n)
  assert.equal(launcherShare(0n, 5000), 0n)
})

/* ── whose launches ──────────────────────────────────────────────────────────────────────── */

test('only this wallet\'s launches, matched case-insensitively', () => {
  const all = [L({ creator: OTHER }), L({ creator: ME.toLowerCase() })]
  assert.equal(launchesBy(all, ME).length, 1)
  assert.equal(launchesBy(all, ME.toUpperCase().replace('0X', '0x')).length, 1)
})

test('no wallet connected means no rows, never everyone\'s', () => {
  assert.deepEqual(launchesBy([L(), L({ creator: OTHER })], null), [])
})

test('newest first', () => {
  const rows = launchesBy([L({ launchedAt: 10n }), L({ launchedAt: 99n })], ME)
  assert.equal(rows[0].launchedAt, 99n)
})

/* ── the rows ────────────────────────────────────────────────────────────────────────────── */

test('a launch with fees but a 100% split shows the fee and a zero share', () => {
  const rows = claimableFor([L({ projectBps: 10000 })], ME, new Map([['0x' + '11'.repeat(20), 500n]]))
  assert.equal(rows[0].pending, 500n)
  assert.equal(rows[0].yours, 0n)
  assert.equal(rows[0].allToProject, true, 'the page must say the project gets it, not show a claimable 0')
})

test('launches with nothing pending are still listed', () => {
  const rows = claimableFor([L()], ME, new Map())
  assert.equal(rows.length, 1, 'an empty page must not be ambiguous between no launches and no fees')
  assert.equal(rows[0].pending, 0n)
})

test('only rows with something pending are worth cranking', () => {
  const rows = claimableFor(
    [L({ token: '0x' + '11'.repeat(20) }), L({ token: '0x' + '22'.repeat(20) })],
    ME, new Map([['0x' + '22'.repeat(20), 7n]]),
  )
  assert.equal(worthCranking(rows).length, 1)
})

test('⛔ totals are per asset and never added across them', () => {
  const rows = claimableFor(
    [L({ token: '0x' + '11'.repeat(20), projectBps: 5000 }),
     L({ token: '0x' + '22'.repeat(20), projectBps: 5000, pairToken: USDG, pairSymbol: 'USDG', pairDecimals: 6 })],
    ME, new Map([['0x' + '11'.repeat(20), 1000n], ['0x' + '22'.repeat(20), 2000n]]),
  )
  const t = totalsByAsset(rows)
  assert.equal(t.length, 2, 'ETH and USDG are two figures, never one')
  assert.equal(t.find((x) => x.symbol === 'ETH').yours, 500n)
  assert.equal(t.find((x) => x.symbol === 'USDG').yours, 1000n)
})
