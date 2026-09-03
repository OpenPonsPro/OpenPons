import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'

/**
 * The one signature this service exists to produce.
 *
 * ⛔ The struct and domain here are pinned by `test/fixtures/claim-vector.json`, which
 * `contracts/test/ClaimVector.t.sol` verifies against the deployed bytecode's own digest. Change
 * anything — a field, an order, the version string — and one of the two suites goes red.
 */
export type Claim = {
  projectId: Hex
  to: Address
  assets: Address[]
  nonce: bigint
  deadline: bigint
}

export async function signClaim(
  claim: Claim,
  cfg: { key: Hex; chainId: number; vault: Address },
): Promise<Hex> {
  const account = privateKeyToAccount(cfg.key)
  return account.signTypedData({
    domain: { name: 'GitVault', version: '1', chainId: cfg.chainId, verifyingContract: cfg.vault },
    types: {
      Claim: [
        { name: 'projectId', type: 'bytes32' },
        { name: 'to', type: 'address' },
        { name: 'assets', type: 'address[]' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Claim',
    message: claim,
  })
}
