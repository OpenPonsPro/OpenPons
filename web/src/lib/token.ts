import { encodeAbiParameters, formatUnits, keccak256, parseAbi, type Address } from 'viem'
import { publicClient } from './chain.ts'
import { pairBy, NATIVE } from './pairs.ts'
import { capUsdScaled } from './marketCap.ts'
import { usdPerAsset } from './usdPrice.ts'
import { LAUNCHPAD, LAUNCHPAD_ABI, PONS_FACTORY, DISTRIBUTOR_ABI, isLive } from './launchpad.ts'

/**
 * Everything a token page shows, read from the chain and nowhere else.
 *
 * ⚠⚠ There is no API behind this site and no database. Every figure here is an `eth_call` made in
 * the visitor's own browser, which is what lets the page be checked: anybody can make the same calls
 * and get the same answers.
 */

const POOL_MANAGER = '0x8366a39CC670B4001A1121B8F6A443A643e40951' as Address

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function logo() view returns (string)',
  'function description() view returns (string)',
])

const CURVE_ABI = parseAbi([
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
  'function graduated() view returns (bool)',
  'function sellableTokens() view returns (uint256)',
])

const FACTORY_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
  'function memeHook() view returns (address)',
])

const PM_ABI = parseAbi(['function extsload(bytes32 slot) view returns (bytes32)'])

export type TokenView = {
  address: Address
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  logo: string
  description: string

  /** From the launchpad registry. Absent when this token was not launched here. */
  /** ⭐ WHICH repo, as recorded on chain: the owner/repo slug in a bytes32. See projects.ts. */
  projectId: `0x${string}`
  distributor: Address
  creator: Address
  projectBps: number
  launchedAt: bigint

  pairToken: Address
  pairSymbol: string
  pairDecimals: number
  curve: Address
  creatorTaxBps: number
  graduated: boolean

  /** Price of one token, in the pair asset. `null` when it cannot be read rather than 0. */
  price: number | null
  marketCap: number | null
  /**
   * ⛔⛔ THE ONE PEOPLE ACTUALLY READ, in USD, scaled by 1e6.
   *
   * `marketCap` above is denominated in the PAIR ASSET, and rendering that with the pair symbol beside
   * it produced "18,420 ETH" on this page while the dashboards showed dollars. A cap in ether is a
   * reserve balance wearing a market cap: two tokens paired against different assets cannot be
   * compared, and the figure moves when ETH moves though nothing about the token changed.
   */
  marketCapUsd: bigint | null

  /** Already pushed to the project, in the pair asset's own units. */
  paidToProject: bigint
  paidToCreator: bigint
  /** Swept into the escrow and waiting for a harvest. ⚠ NOT the same thing as paid. */
  pending: bigint
}

/* ── V4 pool price, for a graduated token ─────────────────────────────────────────────────────
   ⚠ Same maths as the seller contract: poolId is keccak of the ordered key, and the pool's slot0
   sits at keccak(poolId, 6) in the singleton's storage. ⛔ `sqrtPriceX96` is up to 2^160, so
   squaring it in JS floats loses precision fast; the ratio is taken in float only at the end, and
   only because this figure is a display value, never an input to a transaction. */
export async function poolPrice(
  token: Address, pair: Address, fee: number, tickSpacing: number, hooks: Address,
  tokenDecimals: number, pairDecimals: number,
): Promise<number | null> {
  try {
    const tokenIsZero = BigInt(token) < BigInt(pair)
    const [c0, c1] = tokenIsZero ? [token, pair] : [pair, token]
    const id = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
      [c0, c1, fee, tickSpacing, hooks],
    ))
    const base = keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }], [id, 6n]))
    const word = await publicClient.readContract({ address: POOL_MANAGER, abi: PM_ABI, functionName: 'extsload', args: [base] })
    const sq = BigInt(word) & ((1n << 160n) - 1n)
    if (sq === 0n) return null
    const ratio = Number(sq) ** 2 / 2 ** 192 // token1 per token0, raw
    const [d0, d1] = tokenIsZero ? [tokenDecimals, pairDecimals] : [pairDecimals, tokenDecimals]
    const human = ratio * 10 ** (d0 - d1)
    return tokenIsZero ? human : 1 / human
  } catch {
    return null
  }
}

export async function readToken(address: Address): Promise<TokenView | null> {
  if (!isLive()) return null

  /* ⛔ The registry is the gate. A token this launchpad did not create has no project and no split,
     and rendering it with zeroes would show a project of 0x000 as though that were a fact. */
  const entry = await publicClient
    .readContract({ address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'page', args: [0n, 500n] })
    .then((rows) => (rows as readonly { token: Address }[]).find((r) => r.token.toLowerCase() === address.toLowerCase()))
    .catch(() => undefined)
  if (!entry) return null

  const e = entry as unknown as TokenView & { token: Address }
  const pair = pairBy(e.pairToken)
  const pairDecimals = pair?.decimals ?? 18

  const [name, symbol, decimals, totalSupply, logo, description, launched, hook] = await Promise.all([
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => '???'),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'totalSupply' }).catch(() => 0n),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'logo' }).catch(() => ''),
    publicClient.readContract({ address, abi: ERC20_ABI, functionName: 'description' }).catch(() => ''),
    publicClient.readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'getLaunchedToken', args: [address] }).catch(() => null),
    publicClient.readContract({ address: PONS_FACTORY, abi: FACTORY_ABI, functionName: 'memeHook' }).catch(() => null),
  ])

  const curve = (launched?.curve ?? '0x0000000000000000000000000000000000000000') as Address
  const [graduated, reserves, paidToProject, paidToCreator, pending] = await Promise.all([
    curve !== '0x0000000000000000000000000000000000000000'
      ? publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'graduated' }).catch(() => false)
      : Promise.resolve(false),
    curve !== '0x0000000000000000000000000000000000000000'
      ? publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'getReserves' }).catch(() => null)
      : Promise.resolve(null),
    publicClient.readContract({ address: e.distributor, abi: DISTRIBUTOR_ABI, functionName: 'totalToProject', args: [e.pairToken] }).catch(() => 0n),
    publicClient.readContract({ address: e.distributor, abi: DISTRIBUTOR_ABI, functionName: 'totalToOps', args: [e.pairToken] }).catch(() => 0n),
    publicClient.readContract({ address: e.distributor, abi: DISTRIBUTOR_ABI, functionName: 'pending', args: [e.pairToken] }).catch(() => 0n),
  ])

  const dec = Number(decimals)

  /*
    ⚠⚠ Price comes from wherever the token actually trades, and the two places are different maths.
    Before graduation it is the curve's own reserves; after, it is the Uniswap V4 pool. Reading the
    curve on a graduated token returns the reserves it stopped at, which is a stale price presented
    with full confidence.
    ⛔ `null` when neither can be read. A missing price must never render as zero.
  */
  let price: number | null = null
  if (graduated && launched && hook) {
    price = await poolPrice(address, e.pairToken, Number(launched.poolFee), Number(launched.tickSpacing), hook as Address, dec, pairDecimals)
  } else if (reserves) {
    const [q, t] = reserves as readonly [bigint, bigint]
    if (t > 0n) {
      price = Number(formatUnits(q, pairDecimals)) / Number(formatUnits(t, dec))
    }
  }

  const supply = Number(formatUnits(totalSupply as bigint, dec))
  return {
    address,
    name: name as string,
    symbol: symbol as string,
    decimals: dec,
    totalSupply: totalSupply as bigint,
    logo: logo as string,
    description: description as string,
    projectId: (e as unknown as { projectId: `0x${string}` }).projectId,
    distributor: e.distributor,
    creator: e.creator,
    projectBps: Number(e.projectBps),
    launchedAt: e.launchedAt,
    pairToken: e.pairToken,
    pairSymbol: pair?.symbol ?? 'TOKEN',
    pairDecimals,
    curve,
    creatorTaxBps: Number(launched?.creatorTaxBps ?? 0),
    graduated: Boolean(graduated),
    price,
    marketCap: price === null ? null : price * supply,
    /* ⚠ Built from the exact bigint path the dashboards use, not by multiplying the float above.
       `capUsdScaled` takes the cap in the pair's BASE units, so the float cap is converted back
       rather than reused. */
    marketCapUsd: price === null ? null : capUsdScaled(
      BigInt(Math.round(price * supply * 10 ** pairDecimals)),
      pairDecimals,
      await usdPerAsset(e.pairToken, pairDecimals),
    ),
    paidToProject: paidToProject as bigint,
    paidToCreator: paidToCreator as bigint,
    pending: pending as bigint,
  }
}

export const NATIVE_PAIR = NATIVE
