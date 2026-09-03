import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { recoverTypedDataAddress } from 'viem'
import { makeServer } from '../src/server.ts'

const vec = JSON.parse(readFileSync(new URL('./fixtures/claim-vector.json', import.meta.url), 'utf8'))

function boot(overrides = {}) {
  const server = makeServer({
    key: vec.key,
    chainId: vec.domain.chainId,
    vault: vec.domain.verifyingContract,
    checkAdminImpl: async () => ({ ok: true, slug: 'vuejs/core' }),
    readNonce: async () => 0n,
    ...overrides,
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

const post = (server, body) =>
  fetch(`http://127.0.0.1:${server.address().port}/authorize`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const GOOD = {
  code: 'oauth-code',
  owner: 'vuejs',
  repo: 'core',
  wallet: '0x00000000000000000000000000000000000a11ce',
  assets: ['0x0000000000000000000000000000000000000000'],
}

test('a good request comes back signed by the verifier key', async () => {
  const server = await boot()
  try {
    const res = await post(server, GOOD)
    assert.equal(res.status, 200)
    const j = await res.json()
    assert.equal(j.projectId, vec.claim.projectId, 'the slug was encoded, not echoed')
    const signer = await recoverTypedDataAddress({
      domain: { name: 'GitVault', version: '1', chainId: vec.domain.chainId, verifyingContract: vec.domain.verifyingContract },
      types: { Claim: [
        { name: 'projectId', type: 'bytes32' }, { name: 'to', type: 'address' },
        { name: 'assets', type: 'address[]' }, { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ] },
      primaryType: 'Claim',
      message: {
        projectId: j.projectId, to: j.to, assets: j.assets,
        nonce: BigInt(j.nonce), deadline: BigInt(j.deadline),
      },
      signature: j.signature,
    })
    assert.equal(signer, vec.signer)
  } finally { server.close() }
})

test('not-admin is a 403 that names the reason', async () => {
  const server = await boot({ checkAdminImpl: async () => ({ ok: false, reason: 'not-admin' }) })
  try {
    const res = await post(server, GOOD)
    assert.equal(res.status, 403)
    assert.equal((await res.json()).error, 'not-admin')
  } finally { server.close() }
})

test('with an allowed origin, the preflight answers and the POST carries the header', async () => {
  const server = await boot({ allowedOrigin: 'https://openpons.example' })
  try {
    const port = server.address().port
    const pre = await fetch(`http://127.0.0.1:${port}/authorize`, { method: 'OPTIONS' })
    assert.equal(pre.status, 204)
    assert.equal(pre.headers.get('access-control-allow-origin'), 'https://openpons.example')
    const res = await post(server, GOOD)
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://openpons.example')
  } finally { server.close() }
})

test('without an allowed origin, no CORS header leaks', async () => {
  const server = await boot()
  try {
    const res = await post(server, GOOD)
    assert.equal(res.headers.get('access-control-allow-origin'), null)
  } finally { server.close() }
})

test('a malformed wallet never reaches the signer', async () => {
  const server = await boot({ checkAdminImpl: async () => { throw new Error('must not be called') } })
  try {
    const res = await post(server, { ...GOOD, wallet: 'not-an-address' })
    assert.equal(res.status, 400)
  } finally { server.close() }
})
