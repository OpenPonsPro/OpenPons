import { formatUnits } from 'viem'
import { type Launch } from '../lib/launchpad.ts'
import { formatUsd } from '../lib/marketCap.ts'
import { projectFromId } from '../lib/projects.ts'
import { tokenHref } from '../lib/router.ts'
import { Link } from './Link.tsx'
import { TokenImage } from './TokenImage.tsx'

/**
 * One launch, as a GitHub search-result row.
 *
 * ⭐⭐ THE ANATOMY IS A REPO ROW, ON PURPOSE: art where the avatar goes, the repo slug where the
 * repo name goes (blue, because that is what a repository looks like), and a meta line whose
 * "language dot" is the pair asset. A visitor who lives on GitHub reads this list without
 * learning anything.
 *
 * ⚠ The figures on the right are the two that decide a click — market cap, and what the repo has
 * actually been paid. Everything else waits for the token page.
 */

const fmtPair = (v: bigint, d: number) =>
  Number(formatUnits(v, d)).toLocaleString('en-US', { maximumSignificantDigits: 3 })

/** GitHub's language-dot colours, reused as pair-asset dots. */
const DOT: Record<string, string> = { ETH: '#627eea', USDG: '#2da44e' }

function age(ts: bigint): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - Number(ts)))
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`
  return new Date(Number(ts) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function TokenRow({ l }: { l: Launch }) {
  /* ⭐ Decoded straight off the on-chain id — see `projects.ts`. No directory, no request. */
  const repo = projectFromId(l.projectId)?.slug ?? null

  return (
    <Link className="rrow" to={tokenHref(l.token)}>
      <TokenImage uri={l.logo} symbol={l.symbol} className="rrow__art" />

      <div className="rrow__main">
        <div className="rrow__top">
          <span className="rrow__name">{l.name}</span>
          <span className="rrow__sym mono">${l.symbol}</span>
          {l.graduated && <span className="label label--done">Graduated</span>}
        </div>
        <div className="rrow__repo">{repo ?? 'a project recorded on chain'}</div>
        <div className="rrow__meta">
          <span className="rrow__dot" style={{ background: DOT[l.pairSymbol] ?? '#8b949e' }} aria-hidden="true" />
          <span>{l.pairSymbol}</span>
          <span className="rrow__sep">·</span>
          <span>{l.projectBps / 100}% to the repo</span>
          <span className="rrow__sep">·</span>
          <span>{age(l.launchedAt)}</span>
        </div>
      </div>

      <div className="rrow__figs">
        <div className="rrow__fig">
          <span className="rrow__figv">{formatUsd(l.marketCapUsd) ?? '—'}</span>
          <span className="rrow__figk">market cap</span>
        </div>
        <div className="rrow__fig">
          {/* ⛔ In the pair asset's own units, never converted — checkable on chain. */}
          <span className="rrow__figv">{l.raised > 0n ? `${fmtPair(l.raised, l.pairDecimals)} ${l.pairSymbol}` : '—'}</span>
          <span className="rrow__figk">paid to repo</span>
        </div>
      </div>
    </Link>
  )
}
