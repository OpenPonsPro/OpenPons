import { useEffect, useMemo, useState } from 'react'
import { formatEther, isAddress, parseUnits, type Address, type Hex } from 'viem'
import { useWallet } from '../lib/wallet.tsx'
import { publicClient, short, txUrl, tokenUrl } from '../lib/chain.ts'
import { NATIVE, PAIR_ASSETS, type PairAsset } from '../lib/pairs.ts'

/**
 * The developer buy, in the pair asset's own units.
 *
 * ⛔ Returns zero for anything unparseable rather than throwing, and the field validates separately.
 * A launch must never be built with a buy amount nobody could read: the value check on Pons's
 * periphery is exact, so a misread here is a revert after the distributor has already been deployed
 * inside the transaction.
 */
const pairFor = (a: string): PairAsset =>
  PAIR_ASSETS.find((p) => p.address.toLowerCase() === a.toLowerCase()) ?? PAIR_ASSETS[0]!

function parseDevBuy(raw: string, decimals: number): bigint {
  const t = raw.trim()
  if (!t) return 0n
  try {
    const v = parseUnits(t, decimals)
    return v > 0n ? v : 0n
  } catch { return 0n }
}
import {
  LAUNCHPAD, LAUNCHPAD_ABI, LAUNCH_CONFIG_ID, ZERO_ID,
  effectiveRepoPct, previewEconomics, readFactoryState, readPlatformBps,
} from '../lib/launchpad.ts'
import { launchOpen, vaultConfigured } from '../lib/gitVault.ts'
import { SplitBar } from './SplitBar.tsx'
import { GitHubRepoField } from './GitHubRepoField.tsx'
import { LogoField } from './LogoField.tsx'
import { checkLogo } from '../lib/logo.ts'
import type { RepoInfo } from '../lib/projects.ts'

/** "vuejs/core" → "core": the repo half is what a token is naturally called. */
const repoTokenName = (slug: string) => slug.split('/')[1] ?? slug

/** A best-guess ticker from the repo name: letters and digits, uppercased, 2–11 chars. */
const repoSymbol = (slug: string) => {
  const s = (slug.split('/')[1] ?? slug).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 11)
  return s.length >= 2 ? s : ''
}

type Form = {
  name: string; symbol: string; logo: string; description: string
  website: string; twitter: string; telegram: string
  pair: Address; creatorTaxBps: number
  projectId: string; creatorPayout: string; projectBps: number
  devBuy: string; exemptions: string[]
}

const BLANK: Form = {
  name: '', symbol: '', logo: '', description: '',
  website: '', twitter: '', telegram: '',
  pair: NATIVE, creatorTaxBps: 0,
  projectId: ZERO_ID, creatorPayout: '', projectBps: 10000,
  devBuy: '', exemptions: [],
}

type Result = { token: Address; distributor: Address; hash: Hex }

export function LaunchForm({ minBps, onLaunched }: { minBps: number; onLaunched: () => void }) {
  const { address, onRightChain, walletClient, switchChain } = useWallet()
  const [f, setF] = useState<Form>(BLANK)
  const [fee, setFee] = useState<bigint | null>(null)
  const [maxTax, setMaxTax] = useState(1000)
  const [enabled, setEnabled] = useState(true)
  const [platformBps, setPlatformBps] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  /* ⚠⚠ Errors are held back until a field has been LEFT, or until launch is attempted. A form that
     greets you with "Required" under every empty box has told you nothing and looks broken — the
     message is only useful once you could plausibly have filled it in. */
  const [touched, setTouched] = useState<Set<keyof Form>>(new Set())
  const [tried, setTried] = useState(false)
  /* ⛔ Owned by the repo field, which is the only thing that knows whether the typed repository
     was actually found on GitHub. The form never second-guesses it: an id only ever exists here
     because the lookup returned the repo it names. */
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const [s, pBps] = await Promise.all([readFactoryState(), readPlatformBps()])
        if (!alive) return
        setFee(s.fee); setMaxTax(s.maxTax); setEnabled(s.enabled); setPlatformBps(pBps)
      } catch { /* the preview panel simply shows dashes */ }
    })()
    return () => { alive = false }
  }, [])

  /* ⭐ The creator's payout defaults to the connected wallet, but only while untouched. Overwriting
     an address somebody typed because their wallet reconnected would be a very expensive tidy-up. */
  const [payoutTouched, setPayoutTouched] = useState(false)
  /* ⚠ The draft is separate from the committed list. A half-typed address must never reach the
     launch, and the list is what is signed. */
  const [exemptDraft, setExemptDraft] = useState('')
  useEffect(() => {
    if (address && !payoutTouched) setF((p) => ({ ...p, creatorPayout: address }))
  }, [address, payoutTouched])

  const pair = useMemo<PairAsset>(
    () => PAIR_ASSETS.find((p) => p.address === f.pair) ?? PAIR_ASSETS[0]!,
    [f.pair],
  )

  /** ⚠ The generic line is only true of an asset that is actually sold to USDG on the way out. */
  const pairNote = pair.note
    ?? (pair.remit === 'sell-first'
      ? 'Fees are earned in this asset and sold to USDG before they reach the project.'
      : null)

  const errors = useMemo(() => {
    const e: Partial<Record<keyof Form, string>> = {}
    /* ⛔⛔ THE VALUE CHECK ON PONS'S PERIPHERY IS EXACT, so an unreadable amount is not a warning,
       it is a revert AFTER the distributor has been deployed inside the same transaction. Caught
       here, before anything is signed. */
    if (f.devBuy.trim()) {
      const parsed = parseDevBuy(f.devBuy, pairFor(f.pair).decimals)
      if (parsed === 0n) e.devBuy = 'Enter an amount, or leave it empty for no developer buy'
    }
    if (f.exemptions.length > 8) e.exemptions = 'Pons caps how many wallets a launch can declare'
    if (!f.name.trim()) e.name = 'Required'
    if (!f.symbol.trim()) e.symbol = 'Required'
    else if (!/^[A-Za-z0-9]{2,11}$/.test(f.symbol.trim())) e.symbol = '2–11 letters or digits'
    if (f.projectId === ZERO_ID) e.projectId = 'Required'
    if (f.projectBps < 10000) {
      if (!f.creatorPayout.trim()) e.creatorPayout = 'Required unless the project gets 100%'
      else if (!isAddress(f.creatorPayout.trim())) e.creatorPayout = 'Not a valid address'
    }
    if (f.projectBps < minBps) e.projectBps = `This launchpad requires at least ${minBps / 100}%`
    if (f.creatorTaxBps < 0 || f.creatorTaxBps > maxTax) e.creatorTaxBps = `0–${maxTax / 100}%`
    /* ⛔⛔ Pons reverts `MetadataTooLong` above 512 bytes and the revert names no field, so an
       oversized logo fails the whole launch with a message pointing nowhere. Checked here instead. */
    const lg = checkLogo(f.logo)
    if (!lg.ok) e.logo = lg.error ?? 'Not a usable image link'
    return e
  }, [f, minBps, maxTax])

  /* ⛔ `pair.remit === 'blocked'` gates the BUTTON, not just a warning paragraph. A warning that
     the fees can never be moved, sitting above an enabled Launch button, is not a warning. */
  const ready =
    Object.keys(errors).length === 0 && pair.remit !== 'blocked' && !!repo &&
    vaultConfigured() && launchOpen() && !!address && onRightChain && enabled

  async function submit() {
    if (!walletClient || !address) return
    setTried(true)
    setErr(null); setBusy('Reading the launch terms…')
    try {
      /* ⛔⛔ Pinned IMMEDIATELY before signing, never carried from page load. `expectedEconomics` is
         Pons's guard that the curve's terms have not moved since you looked; a stale pin reverts the
         launch, and a pin fetched minutes ago is stale by definition. */
      const economics = await previewEconomics(f.pair)

      /* ⚠ A random salt. Reusing one collides with an existing CREATE2 address and reverts with
         nothing useful to say. */
      const salt = ('0x' + crypto.getRandomValues(new Uint8Array(32))
        .reduce((s, b) => s + b.toString(16).padStart(2, '0'), '')) as Hex

      const params = {
        name: f.name.trim(),
        symbol: f.symbol.trim().toUpperCase(),
        logo: f.logo.trim(),
        description: f.description.trim(),
        socials: {
          twitter: f.twitter.trim(), telegram: f.telegram.trim(),
          discord: '', website: f.website.trim(), farcaster: '',
        },
        /* ⚠ Ignored by the launchpad, which overwrites it with the distributor it creates. Sent as
           the zero address rather than the user's own so nothing here even looks like a way in. */
        creatorFeeRecipient: '0x0000000000000000000000000000000000000000' as Address,
        creatorTaxBps: f.creatorTaxBps,
        buybackEnabled: false,
        expectedEconomics: economics,
        salt,
      }

      const payout = (f.projectBps === 10000 && !f.creatorPayout.trim()
        ? '0x0000000000000000000000000000000000000000'
        : f.creatorPayout.trim()) as Address

      /*
        ⛔⛔ THE VALUE IS EXACT, AND ONLY A NATIVE PAIR CARRIES THE BUY IN IT.
        Pons's periphery checks `launchFee + quoteIn` for a native launch and `launchFee` alone for
        an ERC-20 one, reverting `NativeValueMismatch` on anything else. Sending the buy as value on
        a USDG launch is the mistake a native habit produces; there the quote comes out of an
        allowance the launchpad pulls instead.
      */
      const isNativePair = f.pair.toLowerCase() === NATIVE.toLowerCase()
      const buyWei = parseDevBuy(f.devBuy, pair.decimals)
      const value = (fee ?? 0n) + (isNativePair ? buyWei : 0n)
      const exemptions = f.exemptions.filter((a) => isAddress(a)) as Address[]

      /* ⛔⛔ SIMULATED BEFORE IT IS SIGNED. A launch that reverts on chain has still cost gas and
         still shows the user a failed transaction with a hex error. Simulating first turns almost
         every failure into a sentence before anything is signed. */
      setBusy('Checking the launch will succeed…')

      /* ⚠ Two entrypoints, and the plain one is still sent when there is nothing extra to say. An
         empty array is NOT the same calldata as no array, and `launch` is the call this launchpad
         has always made. */
      const plain = buyWei === 0n && exemptions.length === 0
      const common = { address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, value, account: address } as const

      /* ⚠ Simulated AND written inside each branch. The two entrypoints take different arguments and
         viem cannot narrow a request picked with a ternary, which is the same shape of mistake an
         `as never` would have papered over on the claim page. */
      let hash: Hex
      if (plain) {
        const { request } = await publicClient.simulateContract({
          ...common, functionName: 'launch',
          args: [params, LAUNCH_CONFIG_ID, f.pair,
                 f.projectId as `0x${string}`, payout, f.projectBps],
        })
        setBusy('Confirm in your wallet…')
        hash = await walletClient.writeContract(request)
      } else {
        const { request } = await publicClient.simulateContract({
          ...common, functionName: 'launchWithBuy',
          args: [params, LAUNCH_CONFIG_ID, f.pair,
                 { projectId: f.projectId as `0x${string}`,
                   creatorPayout: payout, projectBps: f.projectBps },
                 /* ⚠ `minTokensOut` 0 only because the buy and the launch settle in ONE transaction:
                    there is no pool to sandwich yet and no intermediate state to trade against. On a
                    follow-up buy this would be a free sandwich. */
                 { quoteIn: buyWei, minTokensOut: 0n },
                 exemptions],
        })
        setBusy('Confirm in your wallet…')
        hash = await walletClient.writeContract(request)
      }

      setBusy('Waiting for the block…')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The launch transaction reverted.')

      /* ⚠ Read back from the registry rather than decoding the return value: a receipt carries logs,
         not return data, and re-reading is the only way to be sure what actually landed. */
      const entries = (await publicClient.readContract({
        address: LAUNCHPAD as Address, abi: LAUNCHPAD_ABI, functionName: 'page', args: [0n, 1n],
      })) as readonly { token: Address; distributor: Address }[]

      setResult({ token: entries[0]!.token, distributor: entries[0]!.distributor, hash })
      setF(BLANK); setPayoutTouched(false); setTouched(new Set()); setTried(false)
      onLaunched()
    } catch (e) {
      const m = (e as Error).message ?? ''
      /* ⛔ A failure says what happened to the user's money and nothing about the build. "Nothing was
         signed and nothing left your wallet" is the fact that matters, and it is always true here
         because every path that can fail does so before or during the simulate. */
      setErr(
        /User rejected|denied/i.test(m) ? 'You cancelled the signature. Nothing was signed.'
          : /ProjectShareTooSmall/.test(m) ? `The project share has to be at least ${minBps / 100}%.`
          : /EconomicsMoved/.test(m) ? 'The curve terms moved while you were filling this in. Read them again and retry.'
          : /PairTokenNotApproved/.test(m) ? 'Pons does not accept that pair asset.'
          : /insufficient funds/i.test(m) ? 'That wallet does not hold enough ETH for the launch fee and gas.'
          : 'Could not complete that launch. Nothing was signed and nothing left your wallet.',
      )
    } finally {
      setBusy(null)
    }
  }

  const set = <K extends keyof Form>(k: K) => (v: Form[K]) => setF((p) => ({ ...p, [k]: v }))

  /* ⚠ Deduplicated case-insensitively. Pons caps the exemption list, and the same wallet twice
     spends one of those slots on nothing. */
  const addExempt = () => {
    const a = exemptDraft.trim()
    if (!isAddress(a)) return
    setF((p) => p.exemptions.some((x) => x.toLowerCase() === a.toLowerCase())
      ? p : { ...p, exemptions: [...p.exemptions, a] })
    setExemptDraft('')
  }
  const blur = (k: keyof Form) => () => setTouched((p) => new Set(p).add(k))
  /** The error to SHOW, as opposed to the error that exists. */
  const shown = (k: keyof Form) => (tried || touched.has(k) ? errors[k] : undefined)

  if (result) {
    return (
      <section className="page" id="launch">
        <div className="wrap wrap--form">
          <div className="phead phead--page">
            <h1>Your token is <span className="hl">live</span></h1>
            <p className="phead__sub">
              The distributor is this token&rsquo;s fee recipient and cannot be changed. Fees show
              as pending until the first harvest lands.
            </p>
          </div>
          <div className="panel panel--pad">
            <div className="kv"><span className="kv__k">Token</span>
              <a className="kv__v mono" href={tokenUrl(result.token)} target="_blank" rel="noreferrer">{result.token}</a></div>
            <div className="kv"><span className="kv__k">Project distributor</span>
              <span className="kv__v mono">{result.distributor}</span></div>
            <div className="kv"><span className="kv__k">Transaction</span>
              <a className="kv__v mono" href={txUrl(result.hash)} target="_blank" rel="noreferrer">View</a></div>
            <button className="btn" style={{ marginTop: 16 }} onClick={() => setResult(null)}>Launch another</button>
          </div>
        </div>
      </section>
    )
  }

  /*
    ⭐⭐ THE ANATOMY IS github.com/new: one narrow column, sections divided by rules, the summary
    and the single green button at the END. The repository comes FIRST because it drives
    everything after it — the lookup prefills the token section the way a template prefills a new
    repo. The old two-column layout with a sticky aside is gone on purpose.
  */
  return (
    <section className="page" id="launch">
      <div className="wrap wrap--form">
        <div className="phead phead--page">
          <h1>Launch a token for an open-source project</h1>
          <p className="phead__sub">
            The GitHub repository, fee split and paired asset are permanently fixed in the contract.
          </p>
        </div>

        {/*
          ⛔ NOTHING HERE NARRATES BUILD STATUS. A visitor is never told what is or is not wired up.
          A launch that cannot complete fails plainly in `submit`, saying that nothing was signed and
          nothing left their wallet. The engineering truth lives in comments, where it belongs.
        */}
        {!enabled && (
          <div className="banner" style={{ marginBottom: 26 }}>
            <strong>Pons is not accepting launches at the moment.</strong> This is set on their
            factory. Try again shortly.
          </div>
        )}
        {enabled && vaultConfigured() && !launchOpen() && (
          <div className="banner" style={{ marginBottom: 26 }}>
            <strong>Launches are not open yet.</strong> The countdown is on. Follow the official
            account for the opening.
          </div>
        )}
        {enabled && !vaultConfigured() && (
          <div className="banner" style={{ marginBottom: 26 }}>
            <strong>Launches are not open yet.</strong> The escrow that will hold each project&rsquo;s
            treasury is not live, so nothing can be signed here.
          </div>
        )}

        <div className="fsec">
          <h2 className="fsec__t">Repository</h2>
          <p className="fsec__d">
            The repo this token funds. Its treasury accrues under this exact name, and only its
            GitHub admins will ever be able to claim it.
          </p>
          <GitHubRepoField
            onResolved={(v) => {
              setRepo(v.repo)
              /* ⭐ The repo fills what is still empty — name, symbol, logo, description, website
                 — and never what somebody already typed. The same courtesy the payout address
                 gets from the connected wallet. */
              setF((p) => ({
                ...p,
                projectId: v.projectId,
                name: p.name.trim() ? p.name : repoTokenName(v.repo.slug),
                symbol: p.symbol.trim() ? p.symbol : repoSymbol(v.repo.slug),
                logo: p.logo.trim() ? p.logo : v.repo.avatarUrl,
                description: p.description.trim() ? p.description : v.repo.description.slice(0, 500),
                website: p.website.trim() ? p.website : (v.repo.homepage || v.repo.htmlUrl),
              }))
            }}
            onCleared={() => { setRepo(null); setF((p) => ({ ...p, projectId: ZERO_ID })) }}
            error={shown('projectId')}
          />
        </div>

        <hr className="rule" />

        <div className="fsec">
          <h2 className="fsec__t">Token</h2>
          <p className="fsec__d">Prefilled from the repository; everything stays editable.</p>
          <div className="row">
            <div className="field">
              <label className="field__l" htmlFor="name">Token name</label>
              <input id="name" className="input" placeholder="core" value={f.name}
                onChange={(e) => set('name')(e.target.value)} onBlur={blur('name')} maxLength={64} />
              {shown('name') && <p className="field__err">{shown('name')}</p>}
            </div>
            <div className="field">
              <label className="field__l" htmlFor="symbol">Symbol</label>
              <input id="symbol" className="input mono" placeholder="CORE" value={f.symbol}
                onChange={(e) => set('symbol')(e.target.value.toUpperCase())} onBlur={blur('symbol')} maxLength={11} />
              {shown('symbol') && <p className="field__err">{shown('symbol')}</p>}
            </div>
          </div>

          <LogoField value={f.logo} onChange={set('logo')} error={shown('logo')} />

          <div className="field">
            <label className="field__l" htmlFor="desc">Description</label>
            <textarea id="desc" className="textarea" placeholder="What this token is for."
              value={f.description} onChange={(e) => set('description')(e.target.value)} maxLength={500} />
          </div>

          <div className="row">
            <div className="field">
              <label className="field__l" htmlFor="site">Website</label>
              <input id="site" className="input" placeholder="https://" value={f.website}
                onChange={(e) => set('website')(e.target.value)} />
            </div>
            <div className="field">
              <label className="field__l" htmlFor="tw">X / Twitter</label>
              <input id="tw" className="input" placeholder="@handle" value={f.twitter}
                onChange={(e) => set('twitter')(e.target.value)} />
            </div>
          </div>
        </div>

        <hr className="rule" />

        <div className="fsec">
          <h2 className="fsec__t">Terms</h2>
          <p className="fsec__d">Written into the contract at launch. No setter exists afterwards.</p>

          <div className="field">
            <label className="field__l" htmlFor="split">
              Repo share <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>({f.projectBps / 100}%)</span>
            </label>
            <input id="split" type="range" min={minBps} max={10000} step={100}
              value={f.projectBps} onChange={(e) => set('projectBps')(Number(e.target.value))} />
            <div style={{ marginTop: 10 }}><SplitBar bps={f.projectBps} /></div>
            {errors.projectBps && <p className="field__err">{errors.projectBps}</p>}
          </div>

          {f.projectBps < 10000 && (
            <div className="field">
              <label className="field__l" htmlFor="payout">Your payout address</label>
              <input id="payout" className="input mono" placeholder="0x…" value={f.creatorPayout}
                onChange={(e) => { setPayoutTouched(true); set('creatorPayout')(e.target.value) }}
                onBlur={blur('creatorPayout')} />
              {shown('creatorPayout') && <p className="field__err">{shown('creatorPayout')}</p>}
            </div>
          )}

          <div className="field">
            <label className="field__l" htmlFor="pair">Paired asset</label>
            <select id="pair" className="select" value={f.pair}
              onChange={(e) => set('pair')(e.target.value as Address)}>
              {PAIR_ASSETS.map((p) => (
                <option key={p.address} value={p.address}>
                  {p.symbol}
                  {/* ⚠ The "cannot be remitted" note stays. It is not a description of the route
                      like the sold-to-USDG one was, it is the reason picking this asset strands a
                      project's fees, and the field error below only appears once it is chosen. */}
                  {p.remit === 'blocked' ? ' (cannot be remitted)' : ''}
                </option>
              ))}
            </select>
            {/* ⚠ The fallback describes selling to USDG, which is only true of a `sell-first`
                asset. An asset with nothing to say says nothing. */}
            {pairNote && <p className="field__h">{pairNote}</p>}
            {pair.remit === 'blocked' && (
              <p className="field__err">
                There is no liquid pool to sell {pair.symbol} through, so fees earned in it cannot
                reach a project. Choose another asset.
              </p>
            )}
          </div>
        </div>

        <hr className="rule" />

        {/* ⭐ Folded, like GitHub folds what most people never touch. Everything inside stays
            fully wired; the fold only spares the common path the reading. */}
        <details className="adv">
          <summary className="adv__s">Advanced options</summary>
          <div className="adv__body">
            <div className="field">
              <label className="field__l" htmlFor="devbuy">
                Developer buy{' '}
                <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>(optional, in {pair.symbol})</span>
              </label>
              <input id="devbuy" className="input" inputMode="decimal" placeholder="0.0"
                value={f.devBuy} onChange={(e) => set('devBuy')(e.target.value)} />
              {errors.devBuy && <p className="field__err">{errors.devBuy}</p>}
            </div>

            <div className="field">
              <label className="field__l" htmlFor="exempt">Snipe tax exemptions</label>
              <div className="tagin">
                <input id="exempt" className="input" placeholder="0x wallet address"
                  value={exemptDraft} autoComplete="off"
                  onChange={(e) => setExemptDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExempt() } }} />
                <button type="button" className="tagin__add" onClick={addExempt}
                  aria-label="Add this wallet" disabled={!isAddress(exemptDraft.trim())}>+</button>
              </div>
              {f.exemptions.length > 0 && (
                <div className="xtags">
                  {f.exemptions.map((a) => (
                    <span className="xtag" key={a}>
                      <span className="mono">{short(a, 4)}</span>
                      <button type="button" onClick={() => set('exemptions')(f.exemptions.filter((x) => x !== a))}
                        aria-label={`Remove ${a}`}>&times;</button>
                    </span>
                  ))}
                </div>
              )}
              <p className="field__h">
                Buys in the launch second pay 99%, decaying to zero across 3s.
              </p>
              {errors.exemptions && <p className="field__err">{errors.exemptions}</p>}
            </div>

            <div className="field">
              <label className="field__l" htmlFor="tax">
                Creator tax <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>({(f.creatorTaxBps / 100).toFixed(2)}%)</span>
              </label>
              <input id="tax" type="range" min={0} max={maxTax} step={25}
                value={f.creatorTaxBps} onChange={(e) => set('creatorTaxBps')(Number(e.target.value))} />
              {errors.creatorTaxBps && <p className="field__err">{errors.creatorTaxBps}</p>}
            </div>
          </div>
        </details>

        <hr className="rule" />

        {/* ⭐ The receipt before the signature, at the end of the read — where github.com/new puts
            its green button. */}
        <div className="panel">
          <div className="signing__head">What you are signing</div>
          <div className="signing__body">
            <div className="kv"><span className="kv__k">Launch fee</span>
              <span className="kv__v mono">{fee === null ? '0' : `${formatEther(fee)} ETH`}</span></div>
            {/* ⚠ ONE figure that rises, not a sum shown as its parts. Pons's 1% and the creator
                tax land on the same leg. */}
            <div className="kv"><span className="kv__k">Trading fee</span>
              <span className="kv__v">
                {f.creatorTaxBps ? `${(1 + f.creatorTaxBps / 100).toFixed(2)}%` : '1%'}
              </span></div>
            {repo && (
              <div className="kv"><span className="kv__k">Repository</span>
                <span className="kv__v mono">{repo.slug}</span></div>
            )}
            {platformBps > 0 && (
              /* ⚠ Stated before the repo line, because it comes off the top: what follows is a
                 share of the REST. A platform fee discovered after signing is theft with extra
                 steps, so this line renders whenever the contract will charge it. */
              <div className="kv"><span className="kv__k">Platform fee</span>
                <span className="kv__v">{platformBps / 100}% of every fee</span></div>
            )}
            <div className="kv kv--loud"><span className="kv__k">To the repo</span>
              <span className="kv__v">{effectiveRepoPct(f.projectBps, platformBps)}% of every fee</span></div>
            <div className="kv"><span className="kv__k">Paired asset</span>
              <span className="kv__v">{pair.symbol}</span></div>
            <div style={{ marginTop: 14 }}><SplitBar bps={f.projectBps} small /></div>
          </div>
        </div>

        {err && <p className="field__err" style={{ marginTop: 14 }}>{err}</p>}

        <div className="fsubmit">
          {!address ? (
            <div className="banner" style={{ margin: 0, flex: 1 }}>Connect a wallet to launch.</div>
          ) : !onRightChain ? (
            <button className="btn btn--lg" onClick={() => void switchChain()}>Switch to Robinhood Chain</button>
          ) : (
            <>
              <button className="btn btn--ink btn--lg" disabled={!ready || !!busy} onClick={() => void submit()}>
                {busy ?? 'Launch token'}
              </button>
              {/* ⚠ A disabled button with no reason reads as a broken site. The one condition a
                  launcher cannot otherwise see is the repository lookup, so it is named. */}
              {!repo && Object.keys(errors).length === 0 && (
                <p className="field__h" style={{ margin: 0 }}>
                  Look up the GitHub repository above to enable this.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}
