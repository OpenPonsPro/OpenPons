import { test } from 'node:test'
import assert from 'node:assert/strict'
import { treasuryRows, claimArgs } from '../src/lib/gitVault.ts'

const ETH = '0x0000000000000000000000000000000000000000'
const USDG = '0x5fc5360d0400a0fd4f2af552add042d716f1d168'

test('treasuryRows pairs each asset with its balance and lifetime, in order', () => {
  const rows = treasuryRows([ETH, USDG], [1000n, 0n], [5000n, 200n])
  assert.deepEqual(rows, [
    { asset: ETH, balance: 1000n, lifetime: 5000n },
    { asset: USDG, balance: 0n, lifetime: 200n },
  ])
})

test('treasuryRows refuses mismatched answers rather than mispairing money', () => {
  assert.throws(() => treasuryRows([ETH], [1n, 2n], [1n]))
})

test('claimArgs maps a verifier authorization to the contract call, bigints and all', () => {
  const args = claimArgs({
    projectId: '0x' + '11'.repeat(32),
    to: '0x00000000000000000000000000000000000a11ce',
    assets: [ETH],
    nonce: '3',
    deadline: '1893456000',
    signature: '0x' + 'ab'.repeat(65),
  })
  assert.deepEqual(args, [
    '0x' + '11'.repeat(32),
    '0x00000000000000000000000000000000000a11ce',
    [ETH],
    3n,
    1893456000n,
    '0x' + 'ab'.repeat(65),
  ])
})

test('effectiveRepoPct: the repo share applies to the post-platform rest', async () => {
  const { effectiveRepoPct } = await import('../src/lib/launchpad.ts')
  assert.equal(effectiveRepoPct(10000, 1000), 90)    // 100% repo of 90% rest
  assert.equal(effectiveRepoPct(9000, 1000), 81)     // 90% of 90%
  assert.equal(effectiveRepoPct(5000, 1000), 45)     // the floor, effectively
  assert.equal(effectiveRepoPct(9000, 0), 90)        // no platform leg = old behaviour
})
