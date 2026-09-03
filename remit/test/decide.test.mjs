import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canRelease, RELEASABLE_ON_RHC } from '../src/decide.ts'

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
const ETH = '0x0000000000000000000000000000000000000000'
const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'

test('native and USDG release', () => {
  assert.equal(canRelease(ETH), true)
  assert.equal(canRelease(USDG), true)
})

test('the check is case-insensitive — checksummed input must not slip past', () => {
  assert.equal(canRelease(USDG.toLowerCase()), true)
  assert.equal(canRelease(USDG.toUpperCase().replace('0X', '0x')), true)
})

test('a tokenized stock is refused before it can be harvested', () => {
  assert.equal(canRelease(AAPL), false)
})

test('the table names its assets for the logs', () => {
  assert.equal(RELEASABLE_ON_RHC[ETH], 'ETH')
  assert.equal(RELEASABLE_ON_RHC[USDG.toLowerCase()], 'USDG')
})
