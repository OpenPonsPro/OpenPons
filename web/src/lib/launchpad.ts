import { parseAbi, formatUnits, type Address } from 'viem'
import { ENV, publicClient } from './chain.ts'
import { NATIVE, pairBy } from './pairs.ts'
import { marketCapInPair, capUsdScaled } from './marketCap.ts'
import { poolPrice } from './token.ts'
import { usdPerAsset } from './usdPrice.ts'
import type { StatRow } from './projectStats.ts'

/**
 * `OpenPonsLaunchpad`, and everything the site reads off it.
 *
 * ⛔⛔ NOT DEPLOYED UNTIL THIS IS SET. Left unset the site renders honestly — the launch form says
 * so and the feed says so — rather than showing a zero that looks like "nobody has launched yet".
 * A launchpad that reports an empty registry when it is really pointing at nothing is the same
 * class of lie as reading one fee ledger and reporting zero.
 */
export const LAUNCHPAD = (ENV?.VITE_LAUNCHPAD || '') as Address | ''
export const PONS_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e' as Address

export const LAUNCH_CONFIG_ID = 0n

export const isLive = () => /^0x[0-9a-fA-F]{40}$/.test(LAUNCHPAD)

/**
 * The protocol's cut, read off the launchpad itself so the form can never advertise a number the
 * contract does not enforce. Cached: it is immutable on chain.
 */
let _platformBps: number | null = null
export async function readPlatformBps(): Promise<number> {
  if (!isLive()) return 0
  if (_platformBps !== null) return _platformBps
  try {
    _platformBps = await publicClient.readContract({
      address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'platformBps',
    }) as number
  } catch { return 0 }
  return _platformBps
}

/** The repo's EFFECTIVE share of every fee, after the platform leg. Pure, tested. */
export function effectiveRepoPct(projectBps: number, platformBps: number): number {
  return ((10_000 - platformBps) * projectBps) / 1_000_000
}

/** The empty id: what the form holds before a repo has been looked up. */
export const ZERO_ID = '0x0000000000000000000000000000000000000000000000000000000000000000'

export const LAUNCHPAD_ABI = parseAbi([
  'struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }',
  'struct LaunchParams { string name; string symbol; string logo; string description; Socials socials; address creatorFeeRecipient; uint16 creatorTaxBps; bool buybackEnabled; bytes32 expectedEconomics; bytes32 salt; }',
  'struct Entry { address token; address curve; address distributor; address creator; address pairToken; uint16 projectBps; uint64 launchedAt; bytes32 projectId; }',
  'function launch(LaunchParams params, uint256 launchConfigId, address pairToken, bytes32 projectId, address creatorPayout, uint16 projectBps) payable returns (address token, address curve, address distributor)',
  'struct ProjectTerms { bytes32 projectId; address creatorPayout; uint16 projectBps; }',
  'struct DevBuy { uint256 quoteIn; uint256 minTokensOut; }',
  /**
   * ⛔⛔ The value is EXACT: `launchFee + quoteIn` for a native pair, `launchFee` alone otherwise,
   * and anything else reverts `NativeValueMismatch`. There is no slack and no tip.
   *
   * ⭐ The bought tokens go to `msg.sender`, which the launchpad passes to Pons's periphery. Pons V1
   * chose the buyer for you and sent it to the fee recipient; here the fee recipient is a
   * distributor that cannot move a token balance out, so that would be permanent.
   */
  'function launchWithBuy(LaunchParams params, uint256 launchConfigId, address pairToken, ProjectTerms terms, DevBuy devBuy, address[] snipeTaxExemptions) payable returns (address token, address curve, address distributor)',
  'error DevBuyUnavailable()',
  'error NativeValueMismatch(uint256 supplied, uint256 expected)',
  'function count() view returns (uint256)',
  'function page(uint256 offset, uint256 limit) view returns (Entry[])',
  'function minProjectBps() view returns (uint16)',
  'function platformBps() view returns (uint16)',
  'error LaunchesClosed()',
  'error ProjectShareTooSmall(uint16 asked, uint16 floorRequired)',
  'error ZeroAddress()',
  'error PairTokenNotApproved(address pairToken)',
  'error EconomicsMoved(bytes32 pinned, bytes32 live)',
])

export const FACTORY_ABI = parseAbi([
  'function launchEnabled() view returns (bool)',
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint256)',
  'function previewLaunchEconomics(uint256 launchConfigId, address pairToken) view returns (bytes32)',
])

export const DISTRIBUTOR_ABI = parseAbi([
  'function totalToProject(address asset) view returns (uint256)',
  'function totalToOps(address asset) view returns (uint256)',
  'function pending(address asset) view returns (uint256)',
  /*
    ⛔⛔ THE TWO THAT MOVE MONEY, AND A LAUNCH ONLY EVER USES ONE.

    Pons keeps TWO escrow ledgers and a launch lands in exactly one: a native launch credits the
    native side and a launch paired against USDG credits only the token side, whose native balance
    reads a truthful, useless zero forever. `harvest` claims the native ledger, `harvestToken` the
    other, and calling the wrong one succeeds while moving nothing.

    ⚠ Both RELEASE as well as claim: the project's share and the launcher's are pushed inside the
    same call. There is no separate withdraw, which is why the interface calls this collecting
    rather than claiming.
  */
  'function harvest() returns (uint256)',
  'function harvestToken(address asset) returns (uint256)',
  /** ⚠ Permissionless passthrough. Pons refuses a sweep from anyone but its operator or the fee
   *  recipient, which is the distributor, so without this a launch's fees wait on Pons's schedule. */
  'function sweepCurve(address curve, uint256 minBuybackTokensOut)',
  'function projectBps() view returns (uint16)',
  'function opsVault() view returns (address)',
])

const CURVE_ABI = parseAbi([
  'function graduated() view returns (bool)',
  /* ⚠ `quoteReserve` INCLUDES the curve's phantom quote, which is virtual and not real money. It
     belongs in the PRICE, because the curve genuinely prices against it, and must be excluded from
     anything describing liquidity or graduation progress. @see marketCap.ts */
  'function getReserves() view returns (uint256 quoteReserve, uint256 tokenReserve)',
])

const FACTORY_MIN_ABI = parseAbi([
  'function getLaunchedToken(address token) view returns ((address token,address curve,address deployer,address creatorFeeRecipient,address pairToken,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,uint16 creatorTaxBps,bool buybackEnabled,uint8 phase,uint256 sweptQuote,uint256 sweptTokens,uint256 sweptAt,bool exists))',
  /** ⚠ The hook the graduated pool is keyed by. Without it the pool id cannot be derived. */
  'function memeHook() view returns (address)',
])

export const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  /**
   * ⛔⛔ THE REAL BURN, AND THE ONLY ONE. Sending to `0x…dEaD` is not burning: the tokens still
   * exist, `totalSupply` does not move, and every market cap on this site is computed from
   * `totalSupply`, so nothing changes. Proven on a fork, and it has cost this stack once already.
   * `ERC20Burnable.burn` destroys them and the supply falls.
   */
  'function burn(uint256 amount)',
])

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  /* ⭐ Read from the token itself rather than guessed from an explorer icon path. The explorer only
     has an icon once it has indexed one, so a brand new launch showed a broken image for its first
     minutes, which is exactly when somebody is looking at it. */
  'function logo() view returns (string)',
])

export type Entry = {
  token: Address
  curve: Address
  distributor: Address
  creator: Address
  pairToken: Address
  projectBps: number
  launchedAt: bigint
  /** ⚠ The struct has carried this all along and the type did not, so nothing could join a launch
   *  to the project it names without reaching past the type. It is the whole promise of a launch. */
  projectId: `0x${string}`
}

export type Launch = Entry & {
  name: string
  symbol: string
  /** Already paid out to the project, in the pair asset's own units. */
  raised: bigint
  /** Swept but not yet claimed. ⚠ A separate number on purpose — see below. */
  pending: bigint
  pairSymbol: string
  pairDecimals: number
  /** The URI stored on the token. Resolve it with `resolveImage` before putting it in a src. */
  logo: string
  /**
   * ⛔ Decides which dashboard a launch appears in, and it appears in exactly ONE. A graduated token
   * trades on a Uniswap V4 pool and a curve one does not; showing a launch in both would also
   * double every count on the page.
   */
  graduated: boolean
  /**
   * Market cap in USD, scaled by 1e6. **Null when it cannot be known**, never zero.
   *
   * ⛔⛔ Null for a graduated launch: graduating sweeps the curve and drains its reserves, so the
   * curve would price the token at nothing. A dash is the honest rendering; a zero beside a live
   * token is a claim that it is worthless.
   */
  marketCapUsd: bigint | null
}

/* ══ reads ══════════════════════════════════════════════════════════════════ */

export async function readFactoryState() {
  const f = { address: PONS_FACTORY, abi: FACTORY_ABI } as const
  const [enabled, fee, maxTax] = await Promise.all([
    publicClient.readContract({ ...f, functionName: 'launchEnabled' }),
    publicClient.readContract({ ...f, functionName: 'launchFee' }),
    publicClient.readContract({ ...f, functionName: 'maxCreatorTaxBps' }),
  ])
  return { enabled, fee, maxTax: Number(maxTax) }
}

export async function previewEconomics(pairToken: Address): Promise<`0x${string}`> {
  return publicClient.readContract({
    address: PONS_FACTORY,
    abi: FACTORY_ABI,
    functionName: 'previewLaunchEconomics',
    args: [LAUNCH_CONFIG_ID, pairToken],
  })
}

export async function readMinProjectBps(): Promise<number> {
  if (!isLive()) return 5000
  return Number(
    await publicClient.readContract({
      address: LAUNCHPAD as Address,
      abi: LAUNCHPAD_ABI,
      functionName: 'minProjectBps',
    }),
  )
}

/**
 * The launch feed, newest first.
 *
 * ⚠⚠ `raised` is what the distributor has ALREADY PUSHED to the project, and `pending` is what is
 * swept but unclaimed. They are shown as two numbers and never added together in one figure headed
 * "raised", because a fee is only the project's once it has moved. Pons pays nothing until somebody
 * calls `claim`, so a combined figure would be a promise dressed as a receipt.
 */
/**
 * ⛔⛔ HOW MANY LAUNCHES ARE READ PER CALL. It is a REQUEST SIZE, NOT A LIMIT ON THE REGISTER.
 *
 * This read used to be a single `page(0, 24)`, and the register outgrew it. Launch 25 onward simply
 * stopped existing as far as the site was concerned: $PROJECT sat at index 26, graduated, at the
 * launchpad's highest market cap, and appeared on no dashboard at all — while its own token page,
 * which reads the token directly, showed it fine. Two of the three graduated tokens were invisible.
 *
 * ⚠ A cap that silently drops the newest rows is worse than a slow page. `count()` decides how many
 * there are and every page is fetched, so the register can grow without the site quietly truncating.
 */
export const PAGE_SIZE = 50

/**
 * The whole register.
 *
 * ⭐ The pages are fetched together and every per-token read is multicall batched, so this is a
 * handful of round trips for the entire launchpad rather than one per launch.
 */
export async function readLaunches(): Promise<Launch[]> {
  if (!isLive()) return []

  const total = (await publicClient.readContract({
    address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'count',
  })) as bigint

  const offsets: bigint[] = []
  for (let o = 0n; o < total; o += BigInt(PAGE_SIZE)) offsets.push(o)

  const pages = await Promise.all(offsets.map((o) =>
    publicClient.readContract({
      address: LAUNCHPAD as Address,
      abi: LAUNCHPAD_ABI,
      functionName: 'page',
      args: [o, BigInt(PAGE_SIZE)],
    }) as Promise<readonly Entry[]>,
  ))
  const entries = pages.flat()

  return Promise.all(
    entries.map(async (e) => {
      const pair = pairBy(e.pairToken)
      /* ⚠ Two waves on purpose: the curve address is only known after the factory answers, and
         `graduated()` lives on the curve. Both waves are multicall batched, so this is two round
         trips for the whole register rather than two per token. */
      const [name, symbol, logo, raised, pend, launched, totalSupply] = await Promise.all([
        publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'name' }).catch(() => 'Unknown'),
        publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => '???'),
        publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'logo' }).catch(() => ''),
        publicClient
          .readContract({ address: e.distributor, abi: DISTRIBUTOR_ABI, functionName: 'totalToProject', args: [e.pairToken] })
          .catch(() => 0n),
        publicClient
          .readContract({ address: e.distributor, abi: DISTRIBUTOR_ABI, functionName: 'pending', args: [e.pairToken] })
          .catch(() => 0n),
        publicClient
          .readContract({ address: PONS_FACTORY, abi: FACTORY_MIN_ABI, functionName: 'getLaunchedToken', args: [e.token] })
          .catch(() => null),
        publicClient.readContract({ address: e.token, abi: ERC20_ABI, functionName: 'totalSupply' }).catch(() => 0n),
      ])

      const curve = launched?.curve
      const hasCurve = curve && curve !== '0x0000000000000000000000000000000000000000'
      const [graduated, reserves] = hasCurve
        ? await Promise.all([
            publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'graduated' }).catch(() => false),
            publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName: 'getReserves' })
              .catch(() => null),
          ])
        : [false, null]

      /* ⚠ The USD rate is per pair ASSET, so it is fetched once per asset and cached, not once per
         launch. A dozen rows priced in ETH make one set of pool reads between them. */
      const usdPerUnit = await usdPerAsset(e.pairToken, pair?.decimals ?? 18)
      const pairDec = pair?.decimals ?? 18

      /*
        ⛔⛔ A GRADUATED TOKEN IS PRICED BY ITS POOL, NOT BY THE CURVE IT LEFT.

        Graduating drains the curve, so `marketCapInPair` correctly refuses to price from it — but
        refusing is only right if something else can. The token page already read the Uniswap V4 pool
        for exactly this case, and the dashboards did not, so the same launch showed a figure on its
        own page and a dash in every list. Every card in the explore page's Graduated section would
        have carried that dash.

        ⚠ Still null while a launch sits in phase 1: graduate() sweeps the curve and hands the
        reserves to the factory, and nobody can trade until somebody pays the gas to create the pool.
        A dash is right THERE, because nothing can price it yet.
      */
      let capInPair: bigint | null = null
      if (graduated) {
        const hook = await publicClient
          .readContract({ address: PONS_FACTORY, abi: FACTORY_MIN_ABI, functionName: 'memeHook' })
          .catch(() => null)
        if (launched && hook) {
          const price = await poolPrice(
            e.token, e.pairToken, Number(launched.poolFee), Number(launched.tickSpacing),
            hook as Address, 18, pairDec,
          )
          if (price !== null && totalSupply > 0n) {
            /* ⚠ Back into the pair's BASE units, the unit `capUsdScaled` takes, rather than being
               multiplied by a rate as a float. */
            const whole = price * (Number(totalSupply) / 1e18)
            if (Number.isFinite(whole) && whole > 0) capInPair = BigInt(Math.round(whole * 10 ** pairDec))
          }
        }
      } else if (reserves) {
        capInPair = marketCapInPair({
          quoteReserve: reserves[0], tokenReserve: reserves[1], totalSupply, graduated: false,
        })
      }

      return {
        ...e,
        projectBps: Number(e.projectBps),
        name,
        symbol,
        raised,
        pending: pend,
        pairSymbol: pair?.symbol ?? 'TOKEN',
        pairDecimals: pair?.decimals ?? 18,
        logo: logo as string,
        graduated: Boolean(graduated),
        marketCapUsd: capUsdScaled(capInPair, pairDec, usdPerUnit),
      }
    }),
  )
}

/**
 * Every launch's project id and what it has paid, for the per-project figures on the directory.
 *
 * ⭐ Deliberately much lighter than `readLaunches`. That one fetches a name, symbol, logo, pending
 * balance, the factory record and a graduation flag for each token — six reads a launch, to render
 * a register. This needs three fields, so it reads the register and one `totalToProject` per launch
 * and nothing else. The directory page is already fetching a megabyte of projects; it must not also
 * pull the whole launch feed to put a number on a card.
 *
 * ⚠ Pages through `count()` rather than assuming one page. `page(0, 500)` silently truncates the
 * moment there are 501 launches, and the failure looks like projects quietly losing their totals.
 */
export async function readProjectStatRows(): Promise<StatRow[]> {
  if (!isLive()) return []

  const total = Number(
    await publicClient.readContract({
      address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'count',
    }),
  )
  if (total === 0) return []

  const PAGE = 200
  const pages: Promise<readonly Entry[]>[] = []
  for (let off = 0; off < total; off += PAGE) {
    pages.push(
      publicClient.readContract({
        address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'page',
        args: [BigInt(off), BigInt(Math.min(PAGE, total - off))],
      }) as Promise<readonly Entry[]>,
    )
  }
  const entries = (await Promise.all(pages)).flat()

  return Promise.all(
    entries.map(async (e) => ({
      projectId: e.projectId,
      pairToken: e.pairToken,
      /* ⚠ `totalToProject`, never `pending`. Paid means pushed. A swept but unclaimed balance is not
         the project's yet, and the site does not add the two together anywhere else either. */
      paid: await publicClient
        .readContract({ address: e.distributor, abi: DISTRIBUTOR_ABI, functionName: 'totalToProject', args: [e.pairToken] })
        .catch(() => 0n),
    })),
  )
}

export const fmtAmount = (v: bigint, decimals: number, max = 4) => {
  const s = formatUnits(v, decimals)
  const n = Number(s)
  if (n === 0) return '0'
  if (n < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

export const NATIVE_ADDRESS = NATIVE
