import type { Address } from 'viem'

/**
 * The assets a Pons V2 launch can be priced in, and — for this launchpad — whether the fees earned
 * in one can actually reach a project.
 *
 * ## ⛔⛔ THE COLUMN THAT MATTERS IS `remit`, NOT `approved`
 *
 * Pons approves 23 ERC-20s alongside native ETH. Creator fees are denominated in whichever one a
 * launch picks, and the pair asset is **fixed at launch forever**. Relay — the bridge that moves
 * value off Robinhood Chain — carries native ETH and USDG and refuses all 21 tokenized equities
 * with "Unsupported currency".
 *
 * ➤ So a stock-paired launch's fees are SOLD to USDG on the Uniswap V4 singleton first, then
 * bridged. That works and is tested against live pools — but it costs an extra swap plus its LP
 * fee, and it only works while that stock has a liquid pool. **MSTR has none**: its only initialised
 * tier holds zero liquidity, so a launch paired against MSTR earns fees nothing can move today.
 */
export type PairAsset = {
  address: Address
  symbol: string
  decimals: number
  /** How the project's share gets off this chain. */
  remit: 'direct' | 'sell-first' | 'blocked'
  note?: string
}

export const NATIVE = '0x0000000000000000000000000000000000000000' as Address
export const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as Address

export const PAIR_ASSETS: PairAsset[] = [
  { address: NATIVE, symbol: 'ETH', decimals: 18, remit: 'direct' },
  { address: USDG, symbol: 'USDG', decimals: 6, remit: 'direct', note: 'The cheapest to remit. About 0.08% of the fee is lost reaching the project.' },
  { address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', decimals: 18, remit: 'sell-first' },
  { address: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', symbol: 'AMD', decimals: 18, remit: 'sell-first' },
  { address: '0x12f190a9F9d7D37a250758b26824B97CE941bF54', symbol: 'AMZN', decimals: 18, remit: 'sell-first' },
  { address: '0x6330D8C3178a418788dF01a47479c0ce7CCF450b', symbol: 'COIN', decimals: 18, remit: 'sell-first' },
  { address: '0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2', symbol: 'COST', decimals: 18, remit: 'sell-first' },
  { address: '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5', symbol: 'CRCL', decimals: 18, remit: 'sell-first' },
  { address: '0x1D11f0496982706C5e14A514D4E79F2e6BdE4516', symbol: 'DJT', decimals: 18, remit: 'sell-first' },
  { address: '0x1b0E319c6A659F002271B69dB8A7df2F911c153E', symbol: 'GME', decimals: 18, remit: 'sell-first', note: 'A thin pool, so larger fee balances are sold in tranches.' },
  { address: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', symbol: 'GOOGL', decimals: 18, remit: 'sell-first' },
  { address: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', symbol: 'META', decimals: 18, remit: 'sell-first' },
  { address: '0xe93237C50D904957Cf27E7B1133b510C669c2e74', symbol: 'MSFT', decimals: 18, remit: 'sell-first' },
  { address: '0xec262a75e413fAfD0dF80480274532C79D42da09', symbol: 'MSTR', decimals: 18, remit: 'blocked', note: 'No liquid pool on this chain, so fees earned in MSTR cannot be moved.' },
  { address: '0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD', symbol: 'MU', decimals: 18, remit: 'sell-first' },
  { address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', symbol: 'NVDA', decimals: 18, remit: 'sell-first' },
  { address: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A', symbol: 'PLTR', decimals: 18, remit: 'sell-first' },
  { address: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', symbol: 'QQQ', decimals: 18, remit: 'sell-first' },
  { address: '0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C', symbol: 'RDDT', decimals: 18, remit: 'sell-first' },
  { address: '0xB90A19fF0Af67f7779afF50A882A9CfF42446400', symbol: 'SNDK', decimals: 18, remit: 'sell-first' },
  { address: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', symbol: 'SPCX', decimals: 18, remit: 'sell-first' },
  { address: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', symbol: 'SPY', decimals: 18, remit: 'sell-first' },
  { address: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', symbol: 'TSLA', decimals: 18, remit: 'sell-first' },
  { address: '0x5e81213613b6B86EaB4c6c50d718d34359459786', symbol: 'TTWO', decimals: 18, remit: 'sell-first' },
]

export const pairBy = (a: string) =>
  PAIR_ASSETS.find((p) => p.address.toLowerCase() === a.toLowerCase())
