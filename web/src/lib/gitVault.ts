import { parseAbi, type Address, type Hex, type WalletClient } from 'viem'
import { ENV, publicClient } from './chain.ts'

/**
 * The shared per-repo treasury, and everything the site reads off it.
 *
 * ⛔⛔ NOT DEPLOYED UNTIL `VITE_GIT_VAULT` IS SET. Left unset the site renders honestly: launches
 * are closed, treasuries read as absent, and the claim page says so. Same posture as `LAUNCHPAD`.
 */
export const GIT_VAULT = (ENV?.VITE_GIT_VAULT || '') as Address | ''

export const vaultConfigured = () =>
  /^0x[0-9a-fA-F]{40}$/.test(GIT_VAULT) && !/^0x0+$/.test(GIT_VAULT)

/**
 * ⭐ The launch switch. Unset or anything but '1', the form is closed with the honest banner while
 * the rest of the site lives on: publish first, open launches when ready. Flipping it is a
 * one-line env change and a redeploy.
 */
export const launchOpen = () => ENV?.VITE_LAUNCH_OPEN === '1'

/** Where `POST /authorize` lives, and the OAuth app the claim page sends people to. */
export const VERIFIER_URL = (ENV?.VITE_VERIFIER_URL || '').replace(/\/$/, '')
export const GITHUB_CLIENT_ID = ENV?.VITE_GITHUB_CLIENT_ID || ''

export const GIT_VAULT_ABI = parseAbi([
  'function balances(bytes32 projectId, address asset) view returns (uint256)',
  'function totalDeposited(bytes32 projectId, address asset) view returns (uint256)',
  'function nonces(bytes32 projectId) view returns (uint256)',
  'function claim(bytes32 projectId, address to, address[] assets, uint256 nonce, uint256 deadline, bytes signature)',
  'event Deposited(bytes32 indexed projectId, address indexed asset, uint256 amount, address indexed from)',
  'event Claimed(bytes32 indexed projectId, address indexed to, address indexed asset, uint256 amount)',
])

export type TreasuryRow = { asset: Address; balance: bigint; lifetime: bigint }

/**
 * ⛔ Pure, and it REFUSES a mismatch. Pairing balances with the wrong asset is showing somebody the
 * wrong amount of money; a thrown error renders as an empty treasury, which is at least not a lie.
 */
export function treasuryRows(assets: Address[], balances: bigint[], lifetimes: bigint[]): TreasuryRow[] {
  if (balances.length !== assets.length || lifetimes.length !== assets.length) {
    throw new Error('answer count does not match asset count')
  }
  return assets.map((asset, i) => ({ asset, balance: balances[i]!, lifetime: lifetimes[i]! }))
}

/** One multicall for a repo's whole treasury: current balance + lifetime per asset. */
export async function readTreasury(projectId: Hex, assets: Address[]): Promise<TreasuryRow[]> {
  if (!vaultConfigured()) return []
  const calls = assets.flatMap((asset) => ([
    { address: GIT_VAULT as Address, abi: GIT_VAULT_ABI, functionName: 'balances' as const, args: [projectId, asset] as const },
    { address: GIT_VAULT as Address, abi: GIT_VAULT_ABI, functionName: 'totalDeposited' as const, args: [projectId, asset] as const },
  ]))
  const out = await publicClient.multicall({ contracts: calls, allowFailure: false })
  return treasuryRows(
    assets,
    assets.map((_, i) => out[i * 2] as bigint),
    assets.map((_, i) => out[i * 2 + 1] as bigint),
  )
}

/** The verifier's answer, verbatim. Numbers travel as strings because JSON has no bigint. */
export type ClaimAuthorization = {
  projectId: Hex
  to: Address
  assets: Address[]
  nonce: string
  deadline: string
  signature: Hex
}

/** ⚠ Pure and tested: the one place the JSON shape becomes calldata. */
export function claimArgs(a: ClaimAuthorization) {
  return [a.projectId, a.to, a.assets, BigInt(a.nonce), BigInt(a.deadline), a.signature] as const
}

export async function sendClaim(walletClient: WalletClient, auth: ClaimAuthorization): Promise<Hex> {
  /* ⛔⛔ SIMULATED BEFORE IT IS SIGNED, like every write on this site: almost every failure becomes
     a sentence instead of a signed, reverted transaction. */
  const { request } = await publicClient.simulateContract({
    address: GIT_VAULT as Address,
    abi: GIT_VAULT_ABI,
    functionName: 'claim',
    args: claimArgs(auth),
    account: walletClient.account!,
  })
  return walletClient.writeContract(request)
}
