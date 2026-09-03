import { createPublicClient, createWalletClient, formatUnits, http, parseAbi, type Address, type Hex } from 'viem'
/* ⚠ The subpath import, `viem/accounts`, or node resolves the whole of viem for one function — a
   resolution error at import time rather than anything the type checker flags. */
import { privateKeyToAccount } from 'viem/accounts'
import { canRelease, RELEASABLE_ON_RHC } from './decide.ts'

/**
 * The keeper: a crank, and nothing but a crank.
 *
 * ## What it does
 *
 * `sweepCurve` and `harvest` on each launch. Both are **permissionless** — the contracts enforce
 * every outcome, and a harvest DELIVERS: the distributor deposits the project's share straight
 * into the GitVault under the launch's projectId, in the same transaction. There is no bridge, no
 * payer, no ledger and no off-chain state; the keeper runs these calls only because somebody has
 * to and it is already awake.
 *
 * ## ⛔⛔ THE ONE RULE THIS FILE EXISTS TO ENFORCE
 *
 * **A stock-paired launch is refused BEFORE it is harvested.** `_release` reverts `NotPayable`
 * for anything but native ETH and USDG, so the harvest itself cannot strand a stock — but the
 * simulate-first discipline below would then skip it silently forever. Refusing it loudly, before
 * anything runs, keeps the share in the Pons escrow where it stays recoverable, and prints WHY on
 * every pass until `V4Seller` is driven to sell it. See `decide.ts` and `sell.ts`.
 *
 * ⚠ `--send` is never the default. A dry run simulates the same calls and signs nothing.
 */

const RHC_RPC = process.env.RHC_RPC ?? 'https://rpc.mainnet.chain.robinhood.com'
const LAUNCHPAD = (process.env.LAUNCHPAD ?? '') as Address

const rhc = {
  id: 4663, name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RHC_RPC] } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' as Address } },
} as const

/**
 * ⛔⛔ ROBINHOOD CHAIN'S RPC IS BEHIND CLOUDFLARE, AND IT CHALLENGES A DEFAULT AGENT.
 *
 * Node's fetch sends its own User-Agent, and from a datacenter address Cloudflare answers the
 * managed challenge instead of JSON — a failure that names no cause and only appears once the
 * keeper is somewhere other than a laptop. A browser agent is answered normally; there is no token
 * and no allowlist. Same fix as `scripts/rpc-proxy.mjs`.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/* ⚠ Retries above viem's default three: a pass is a burst against a public endpoint, and three
   attempts inside one second are three attempts into the same closed rate-limit window. */
const rpc = (url: string) =>
  http(url, {
    fetchOptions: { headers: { 'User-Agent': BROWSER_UA } },
    retryCount: 6,
    retryDelay: 800,
    timeout: 30_000,
  })

export const rhcClient = createPublicClient({ chain: rhc, transport: rpc(RHC_RPC), batch: { multicall: true } })

const PAD_ABI = parseAbi([
  'struct Entry { address token; address curve; address distributor; address creator; address pairToken; uint16 projectBps; uint64 launchedAt; bytes32 projectId; }',
  'function count() view returns (uint256)',
  'function page(uint256 offset, uint256 limit) view returns (Entry[])',
])
const DIST_ABI = parseAbi([
  'function sweepCurve(address curve, uint256 minBuybackTokensOut)',
  'function harvest() returns (uint256)',
  'function harvestToken(address asset) returns (uint256)',
  'function pending(address asset) view returns (uint256)',
  'function totalToProject(address asset) view returns (uint256)',
])

export type Launch = {
  token: Address
  curve: Address
  distributor: Address
  pairToken: Address
  projectId: Hex
  /** Lifetime, deposited by this launch's distributor into the GitVault. */
  delivered: bigint
  /** Sitting in the Pons escrow, claimable by a harvest. */
  pending: bigint
}

const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address
export const decimalsOf = (asset: Address) => (asset.toLowerCase() === USDG.toLowerCase() ? 6 : 18)

export async function readLaunches(): Promise<Launch[]> {
  const n = await rhcClient.readContract({ address: LAUNCHPAD, abi: PAD_ABI, functionName: 'count' })
  if (n === 0n) return []
  const rows = await rhcClient.readContract({
    address: LAUNCHPAD, abi: PAD_ABI, functionName: 'page', args: [0n, n],
  })
  return Promise.all(rows.map(async (e) => ({
    token: e.token, curve: e.curve, distributor: e.distributor,
    pairToken: e.pairToken, projectId: e.projectId,
    delivered: await rhcClient.readContract({
      address: e.distributor, abi: DIST_ABI, functionName: 'totalToProject', args: [e.pairToken],
    }).catch(() => 0n),
    pending: await rhcClient.readContract({
      address: e.distributor, abi: DIST_ABI, functionName: 'pending', args: [e.pairToken],
    }).catch(() => 0n),
  })))
}

async function main() {
  const send = process.argv.includes('--send')
  if (!/^0x[0-9a-fA-F]{40}$/.test(LAUNCHPAD)) throw new Error('LAUNCHPAD is not set')

  /* ⛔ The key is read from the environment and never written anywhere, never logged. Cranking is
     permissionless, so any funded key will do — there is no on-chain keeper role left to check. */
  const key = process.env.KEEPER_KEY
  if (send && !key) throw new Error('--send needs KEEPER_KEY')
  const account = key ? privateKeyToAccount(key as Hex) : undefined
  const wallet = account ? createWalletClient({ account, chain: rhc, transport: rpc(RHC_RPC) }) : undefined

  const launches = await readLaunches()
  console.log(`launchpad ${LAUNCHPAD}`)
  console.log(`launches  ${launches.length}\n`)

  for (const l of launches) {
    /* ⚠ One launch's bad luck must not abandon the rest of the pass: an unhandled throw here would
       silently cost every launch after this one a turn. Caught per launch, picked up next pass. */
    try {
      const d = decimalsOf(l.pairToken)
      console.log(`${l.token}`)
      console.log(`  project id   ${l.projectId}`)
      console.log(`  delivered    ${formatUnits(l.delivered, d)}   (lifetime, into the GitVault)`)
      console.log(`  in escrow    ${formatUnits(l.pending, d)}   (a harvest delivers this)`)

      /*
        ⛔⛔ CHECKED BEFORE THE HARVEST. A stock-paired launch's share must stay in the Pons escrow,
        where it is recoverable the day the V4 sell path is driven; `_release` would refuse it with
        `NotPayable` anyway, but refusing here keeps the reason on the record every pass.
      */
      if (!canRelease(l.pairToken)) {
        console.log(`  ⛔ paired in ${l.pairToken} which the distributor cannot release — NOT harvested, sell it to USDG first\n`)
        continue
      }

      /* 🔴🔴 SIMULATED FIRST, ALWAYS. Both calls revert when there is nothing to do, which is the
         NORMAL state of a quiet launch, and a reverted transaction still costs gas. A simulate is
         an eth_call: free, and it answers the same question. */
      const canSweep = await rhcClient.simulateContract({
        address: l.distributor, abi: DIST_ABI, functionName: 'sweepCurve', args: [l.curve, 0n],
        account: account ?? '0x0000000000000000000000000000000000000001',
      }).then(() => true).catch(() => false)
      if (canSweep) {
        if (send && wallet) {
          const h = await wallet.writeContract({
            address: l.distributor, abi: DIST_ABI, functionName: 'sweepCurve', args: [l.curve, 0n],
          })
          await rhcClient.waitForTransactionReceipt({ hash: h })
          console.log('  swept')
        } else {
          console.log('  would sweep')
        }
      }

      const claimable = await rhcClient.readContract({
        address: l.distributor, abi: DIST_ABI, functionName: 'pending', args: [l.pairToken],
      }).catch(() => 0n)
      if (claimable > 0n) {
        const isNative = l.pairToken.toLowerCase() === '0x0000000000000000000000000000000000000000'
        if (send && wallet) {
          const h = isNative
            ? await wallet.writeContract({ address: l.distributor, abi: DIST_ABI, functionName: 'harvest' })
            : await wallet.writeContract({ address: l.distributor, abi: DIST_ABI, functionName: 'harvestToken', args: [l.pairToken] })
          await rhcClient.waitForTransactionReceipt({ hash: h })
          console.log(`  harvested ${formatUnits(claimable, d)} — delivered to the vault in the same transaction`)
        } else {
          console.log(`  would harvest ${formatUnits(claimable, d)} (${RELEASABLE_ON_RHC[l.pairToken.toLowerCase()] ?? '?'})`)
        }
      }
      console.log()
    } catch (err) {
      const e = err as { shortMessage?: string; message?: string }
      console.log(`  ⚠ skipped this pass: ${String(e?.shortMessage ?? e?.message ?? err).slice(0, 140)}\n`)
      continue
    }
  }

  if (!send) {
    console.log('DRY RUN. Nothing was signed.')
    console.log('Pass --send with KEEPER_KEY set to act.')
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
