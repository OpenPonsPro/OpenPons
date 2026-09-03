import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  indexByProject, statFor, paidParts, amountsComparable, soleAsset, paidIn, totals, plural, ZERO_CONFIG,
} from '../src/lib/projectStats.ts'

const A = '0x' + 'a1'.repeat(32)
const B = '0x' + 'b2'.repeat(32)
const ETH = '0x0000000000000000000000000000000000000000'
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const row = (o) => ({ projectId: A, pairToken: ETH, paid: 0n, ...o })

test('launches are counted per project and paid totals accumulate', () => {
  const i = indexByProject([
    row({ projectId: A, paid: 400000000000000000n }),
    row({ projectId: A, paid: 100000000000000000n }),
    row({ projectId: B, paid: 7n }),
  ])
  assert.equal(statFor(i, A).launches, 2)
  assert.equal(statFor(i, A).byAsset[ETH], 500000000000000000n)
  assert.equal(statFor(i, B).launches, 1)
})

test('a project with no launch here has no stat at all — not a zero', () => {
  const i = indexByProject([row({ projectId: A })])
  assert.equal(statFor(i, B), null, 'absence must be absence, so the card renders no money line')
})

test('a launch paying a wallet directly joins to no card', () => {
  const i = indexByProject([row({ projectId: ZERO_CONFIG }), row({ projectId: A })])
  assert.equal(Object.keys(i).length, 1)
  assert.equal(statFor(i, ZERO_CONFIG), null)
})

test('config ids join case-insensitively', () => {
  const i = indexByProject([row({ projectId: A.toUpperCase().replace('0X', '0x') })])
  assert.equal(statFor(i, A).launches, 1, 'a checksum difference must not read as a project we never launched for')
})

/* ── the rule that matters: never add ether to dollars ───────────────────────────────────── */

test('⛔ totals are kept PER ASSET and never summed across them', () => {
  const i = indexByProject([
    row({ projectId: A, pairToken: ETH, paid: 400000000000000000n }),   // 0.4 ETH
    row({ projectId: A, pairToken: USDG, paid: 120000000n }),           // 120 USDG, 6dp
  ])
  const s = statFor(i, A)
  assert.equal(Object.keys(s.byAsset).length, 2)
  const parts = paidParts(s)
  assert.equal(parts.length, 2, 'two assets must render as two figures, never one')
  assert.ok(parts.some((p) => p.endsWith(' ETH')) && parts.some((p) => p.endsWith(' USDG')))
})

test('an asset that has paid nothing is dropped, so a fresh launch shows no money line', () => {
  const i = indexByProject([row({ projectId: A, paid: 0n })])
  assert.equal(statFor(i, A).launches, 1, 'the launch still counts')
  assert.deepEqual(paidParts(statFor(i, A)), [], 'but "0 ETH" is never rendered')
})

test('ranking by amount is refused the moment two assets have paid', () => {
  const one = indexByProject([row({ projectId: A, pairToken: ETH, paid: 5n })])
  assert.equal(amountsComparable(one), true)
  assert.equal(soleAsset(one), ETH.toLowerCase())

  const two = indexByProject([
    row({ projectId: A, pairToken: ETH, paid: 5n }),
    row({ projectId: B, pairToken: USDG, paid: 5n }),
  ])
  assert.equal(amountsComparable(two), false, 'comparing ether to dollars sorts by decimal count')
  assert.equal(soleAsset(two), null)
})

test('an unpaid second asset does not spoil comparability', () => {
  const i = indexByProject([
    row({ projectId: A, pairToken: ETH, paid: 5n }),
    row({ projectId: B, pairToken: USDG, paid: 0n }),
  ])
  assert.equal(amountsComparable(i), true, 'a launch that has earned nothing yet is not a second unit')
})

test('paidIn is zero for a project we have never launched for, so sorting is stable', () => {
  const i = indexByProject([row({ projectId: A, paid: 9n })])
  assert.equal(paidIn(statFor(i, B), ETH.toLowerCase()), 0n)
  assert.equal(paidIn(null, null), 0n)
})

/* ── the line above the grid ─────────────────────────────────────────────────────────────── */

test('totals count distinct projects, not launches', () => {
  const t = totals(indexByProject([
    row({ projectId: A, paid: 1n }), row({ projectId: A, paid: 1n }), row({ projectId: B, paid: 1n }),
  ]))
  assert.equal(t.launches, 3)
  assert.equal(t.projects, 2)
})

test('an empty register totals to nothing and renders no figures', () => {
  const t = totals(indexByProject([]))
  assert.deepEqual({ launches: t.launches, projects: t.projects, paid: t.paid }, { launches: 0, projects: 0, paid: [] })
})

test('plural does not write "1 launches"', () => {
  assert.equal(plural(1, 'launch', 'launches'), '1 launch')
  assert.equal(plural(2, 'launch', 'launches'), '2 launches')
  assert.equal(plural(0, 'launch', 'launches'), '0 launches')
})
