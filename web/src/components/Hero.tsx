import { useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { type Launch } from '../lib/launchpad.ts'
import { HOW, LAUNCH } from '../lib/router.ts'
import { TOKEN_CA, hasTokenCa } from '../lib/brand.ts'
import { Link } from './Link.tsx'
import { SplitBar } from './SplitBar.tsx'

/**
 * The site's own contract address, under the hero copy.
 *
 * ⚠⚠ A BUTTON ONLY WHEN THERE IS SOMETHING TO COPY. Rendering the copy affordance around `TBA`
 * gives people a control that does nothing, and a control that does nothing is worse than none:
 * it gets pressed, and the silence reads as the page being broken rather than as the address not
 * existing yet. With no address it is plain text.
 *
 * ⚠ `navigator.clipboard` is undefined on an insecure origin and can be refused even on a secure
 * one, so the write is guarded. A refusal leaves the label alone rather than claiming a copy that
 * did not happen.
 */
function CaStrip() {
  const [copied, setCopied] = useState(false)

  const ca = hasTokenCa() ? TOKEN_CA : null

  if (!ca) {
    return (
      <p className="ca ca--tba">
        <span className="ca__k">CA:</span>
        <span className="ca__v">TBA</span>
      </p>
    )
  }

  const copy = () => {
    void navigator.clipboard?.writeText(ca).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  return (
    /* ⭐ THE WHOLE STRIP IS THE BUTTON. A separate copy control beside a long address is a small
       target most people never aim at; the address itself is the thing they are already looking
       at, so it is the thing that copies.
       ⚠ `aria-live` on the confirmation, because for a screen reader the only evidence a click did
       anything is a word that changed somewhere else on the line. */
    <button type="button" className={`ca ca--btn${copied ? ' is-copied' : ''}`} onClick={copy}
      title="Copy the contract address" aria-label={`Copy the contract address ${ca}`}>
      <span className="ca__k">CA:</span>
      <span className="ca__v mono">{ca}</span>
      <span className="ca__say" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  )
}

/**
 * ⭐ The example treasury card, back by the operator's call — the product as illustration, drawn
 * with the site's own components, the mascot as its avatar. Decorative (`aria-hidden`, nothing
 * clickable); the figures are a worked example, not a live read.
 */
function DemoTreasury() {
  return (
    <div className="demo" aria-hidden="true">
      <div className="demo__head">
        <span className="demo__avatar"><img src="/mascot-cut.png" alt="" /></span>
        <span className="demo__slug mono">vuejs/core</span>
        <span className="label label--ok">treasury</span>
      </div>
      <div className="demo__body">
        <SplitBar bps={7500} small />
        <div className="kv"><span className="kv__k">Claimable now</span>
          <span className="kv__v">9.3 ETH</span></div>
        <div className="kv"><span className="kv__k">Lifetime</span>
          <span className="kv__v">36.1 ETH</span></div>
        <div className="kv"><span className="kv__k">Who can claim</span>
          <span className="kv__v">a repo admin, via GitHub</span></div>
      </div>
      <div className="demo__foot">
        <span className="btn btn--ink" style={{ pointerEvents: 'none' }}>Claim everything</span>
      </div>
    </div>
  )
}

export function Hero({
  launches, minBps, loading,
}: {
  launches: Launch[]; minBps: number; loading: boolean
}) {
  /*
    ⭐ Summed from each distributor's `totalToProject` via the register — and that IS delivered
    money: a harvest deposits the project's share into the GitVault in the same transaction, so
    this figure is what repos hold or have claimed, checkable per launch on an explorer.

    ⛔ PER PAIR ASSET, never added across assets: ETH plus USDG is the mixed-unit bug this stack
    has shipped once already, and the larger number would always be the smaller amount.
  */
  const delivered = useMemo(() => {
    const by = new Map<string, { amount: bigint; decimals: number }>()
    for (const l of launches) {
      if (l.raised === 0n) continue
      const cur = by.get(l.pairSymbol) ?? { amount: 0n, decimals: l.pairDecimals }
      cur.amount += l.raised
      by.set(l.pairSymbol, cur)
    }
    return [...by.entries()].map(([symbol, v]) => ({ symbol, ...v }))
  }, [launches])

  const deliveredLine = loading || delivered.length === 0
    ? '0'
    : delivered.map((d) => `${Number(formatUnits(d.amount, d.decimals)).toLocaleString('en-US', { maximumSignificantDigits: 3 })} ${d.symbol}`).join('  ')

  return (
    <section className="shero" id="top">
      <div className="wrap">
        <div className="shero__grid">
          <div className="shero__copy">
            <p className="shero__eyebrow">Built on Pons V2 · Robinhood Chain</p>
            <h1>Fund the repos you <span className="hl">trade</span> on</h1>
            <p className="shero__sub">
              Pick a repo. Launch its token. Every trade funds the people who write the code,
              on terms written into the contract, forever.
            </p>
            <div className="shero__cta">
              <Link className="btn btn--ink btn--lg" to={LAUNCH}>Launch a token</Link>
              <Link className="btn btn--lg" to={HOW}>How it works</Link>
            </div>
            <CaStrip />
          </div>
          <DemoTreasury />
        </div>

        {/* ⭐ Pinned-repo boxes, not a stat strip: three small bordered facts, the shape GitHub
            uses for the things it wants you to see first. */}
        <div className="pins">
          <div className="pin">
            <span className="pin__k">Paid to repos</span>
            <span className="pin__v">{deliveredLine}</span>
          </div>
          <div className="pin">
            <span className="pin__k">Launches</span>
            <span className="pin__v">{loading ? '0' : launches.length}</span>
          </div>
          <div className="pin">
            <span className="pin__k">Minimum repo share</span>
            <span className="pin__v">{minBps / 100}<small>%</small></span>
          </div>
        </div>
      </div>
    </section>
  )
}
