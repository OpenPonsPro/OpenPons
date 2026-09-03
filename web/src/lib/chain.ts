import { createPublicClient, defineChain, http } from 'viem'

/**
 * Robinhood Chain.
 *
 * ⚠⚠ This chain makes a block roughly every 100ms and the public RPC caps `eth_getLogs` at 2,000
 * blocks — about three minutes of history. Nothing on this site reads a log for that reason. The
 * launch feed comes out of an array on `OpenPonsLaunchpad`, read with `eth_call`, which is why there
 * is no indexer, no database and no backend to keep alive.
 *
 * ⚠ `rpc.robinhood.com` does NOT resolve. The working host is `rpc.mainnet.chain.robinhood.com`.
 */
/*
  ⚠⚠ READ DEFENSIVELY, never as `import.meta.env.VITE_RHC_RPC`.

  Vite defines `import.meta.env`, but any script that imports this module under plain Node, which is
  how the address checks and the launch helpers get tested, finds it UNDEFINED and a direct property
  read throws before a single line of the test runs. Testing the real module beats testing a copy of
  it, so the module has to survive being imported outside a bundler.
*/
declare const process: { env?: Record<string, string | undefined> } | undefined

export const ENV =
  (import.meta as { env?: Record<string, string | undefined> }).env ??
  (typeof process !== 'undefined' ? process?.env : undefined)

export const RHC_RPC = ENV?.VITE_RHC_RPC || 'https://rpc.mainnet.chain.robinhood.com'

export const rhc = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RHC_RPC] } },
  blockExplorers: { default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' } },
  /* ⭐⭐ Multicall3 is deployed at the canonical address on this chain, verified on 29 Aug 2026
     (3,808 bytes of code). Declaring it lets viem collapse every independent `readContract` in a
     tick into ONE request. The register makes four reads per token; at twenty tokens that is
     eighty round trips against a rate limited public RPC, and it is the whole difference between a
     list that appears and a list that trickles in. */
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
})

export const publicClient = createPublicClient({
  chain: rhc,
  transport: http(RHC_RPC),
  /* ⚠ `wait` is short on purpose. Batching collects calls made within the window, and a long window
     delays the first paint by exactly that much for no gain when the calls are already issued
     together in a `Promise.all`. */
  batch: { multicall: { batchSize: 1024, wait: 16 } },
})

export const EXPLORER = 'https://robinhoodchain.blockscout.com'
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`
export const tokenUrl = (a: string) => `${EXPLORER}/token/${a}`

export const short = (a?: string, n = 4) =>
  !a ? '' : `${a.slice(0, 2 + n)}…${a.slice(-n)}`
