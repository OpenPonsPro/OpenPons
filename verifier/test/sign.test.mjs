import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { signClaim } from '../src/sign.ts'

const vec = JSON.parse(readFileSync(new URL('./fixtures/claim-vector.json', import.meta.url), 'utf8'))

test('signClaim reproduces the committed vector byte for byte', async () => {
  const sig = await signClaim(
    {
      projectId: vec.claim.projectId,
      to: vec.claim.to,
      assets: vec.claim.assets,
      nonce: BigInt(vec.claim.nonce),
      deadline: BigInt(vec.claim.deadline),
    },
    { key: vec.key, chainId: vec.domain.chainId, vault: vec.domain.verifyingContract },
  )
  assert.equal(sig, vec.signature)
})
