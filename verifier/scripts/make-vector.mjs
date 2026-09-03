/**
 * Generates test/fixtures/claim-vector.json — the ONE signature both stacks verify.
 *
 * ⛔ Run once and COMMIT the output. The point of the fixture is that neither side can drift its
 * EIP-712 encoding without a committed byte going stale; regenerating it on every run would let
 * both sides drift together.
 *
 * ⚠ The key is anvil's first well-known account. Tests only; nothing real may ever use it.
 */
import { writeFileSync } from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'

const key = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const account = privateKeyToAccount(key)

const domain = {
  name: 'GitVault',
  version: '1',
  chainId: 31337,
  verifyingContract: '0x0000000000000000000000000000000000004242',
}

const types = {
  Claim: [
    { name: 'projectId', type: 'bytes32' },
    { name: 'to', type: 'address' },
    { name: 'assets', type: 'address[]' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

// "vuejs/core" right-padded to 32 bytes — the projects.ts encoding of the slug.
const projectId = '0x' + Buffer.from('vuejs/core', 'utf8').toString('hex').padEnd(64, '0')

const message = {
  projectId,
  to: '0x00000000000000000000000000000000000a11ce',
  assets: ['0x0000000000000000000000000000000000000000', '0x00000000000000000000000000000000000000d6'],
  nonce: 0n,
  deadline: 1893456000n, // 2030-01-01, far past any test clock
}

const signature = await account.signTypedData({ domain, types, primaryType: 'Claim', message })

const out = new URL('../test/fixtures/claim-vector.json', import.meta.url)
writeFileSync(out, JSON.stringify({
  key,
  signer: account.address,
  domain,
  claim: { ...message, nonce: '0', deadline: '1893456000' },
  signature,
}, null, 2) + '\n')
console.log('wrote', out.pathname)
console.log('signer', account.address)
console.log('signature', signature)
