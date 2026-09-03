import { useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import { addrUrl, short, tokenUrl } from '../lib/chain.ts'
import { readToken, type TokenView } from '../lib/token.ts'
import { effectiveRepoPct, readPlatformBps } from '../lib/launchpad.ts'
import { formatUsd } from '../lib/marketCap.ts'
import { BurnPanel } from './BurnPanel.tsx'
import { projectFromId, projectPage, type Project } from '../lib/projects.ts'
import { TokenImage } from './TokenImage.tsx'
import { SplitBar } from './SplitBar.tsx'
import { Link } from './Link.tsx'
import { EXPLORE } from '../lib/router.ts'

const fmt = (v: bigint, d: number, max = 4) => {
  const n = Number(formatUnits(v, d))
  if (n === 0) return '0'
  if (n < 0.0001) return '<0.0001'
  return n.toLocaleString('en-US', { maximumFractionDigits: max })
}

function when(ts: bigint) {
  const d = new Date(Number(ts) * 1000)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function TokenPage({ address }: { address: Address }) {
  const [t, setT] = useState<TokenView | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  /* ⭐ The whole promise is "this token pays X", so the page has to be able to say X. The chain
     records an id; the directory turns it into a name and a link to where it is published. */
  const [project, setProject] = useState<Project | null>(null)
  const [platformBps, setPlatformBps] = useState(0)

  useEffect(() => {
    let live = true
    setState('loading')
    void (async () => {
      const v = await readToken(address).catch(() => null)
      if (!live) return
      setT(v)
      setState(v ? 'ready' : 'missing')
      /* ⭐ Decoded straight off the on-chain id — see `projects.ts`. No directory, no request. */
      if (v?.projectId) setProject(projectFromId(v.projectId))
      void readPlatformBps().then((b) => { if (live) setPlatformBps(b) }).catch(() => {})
    })()
    return () => { live = false }
  }, [address])

  if (state === 'loading') {
    return <section><div className="wrap"><div className="empty">Reading the chain</div></div></section>
  }

  /* ⛔ A token this launchpad did not create has no project and no split. Rendering it with zeroes
     would present a project of 0x000 as a fact about somebody's token. */
  if (state === 'missing' || !t) {
    return (
      <section>
        <div className="wrap">
          <div className="head head--center">
            <p className="eyebrow">Not found</p>
            <h2>No project launch at this address</h2>
            <p>
              This page only shows tokens launched through Open<span className="pons">Pons</span>, because only those have a
              project and a split recorded on chain.
            </p>
          </div>
          <Link className="btn" to={EXPLORE}>Back to the dashboard</Link>
        </div>
      </section>
    )
  }

  const creatorBps = 70 + t.creatorTaxBps            // basis points of volume, x100
  const toProject = (creatorBps * (t.projectBps / 10000)) / 100

  return (
    <>
      {/*
        ⭐⭐ THE ANATOMY IS A REPO PAGE: an identity header under the site header, then a main
        column with a right-hand About sidebar. A GitHub user has read a thousand of these; this
        token IS a repo's token, so it borrows the shape whole.
      */}
      <section className="tok">
        <div className="wrap">
          <Link className="tok__back" to={EXPLORE}>Back to the dashboard</Link>

          <div className="repohead">
            <TokenImage uri={t.logo} symbol={t.symbol} className="repohead__art" />
            <div className="repohead__id">
              <div className="repohead__crumb">
                {project
                  ? <a href={projectPage(project)} target="_blank" rel="noreferrer">{project.name}</a>
                  : <span className="mono">{short(t.projectId, 8)}</span>}
                <span className="repohead__sep">/</span>
                <span className="mono">${t.symbol}</span>
              </div>
              <h1 className="repohead__name">{t.name}</h1>
            </div>
            <div className="tok__badges">
              <span className="tag">{t.graduated ? 'Trading on the pool' : 'On the curve'}</span>
              <span className="tag">Priced in {t.pairSymbol}</span>
            </div>
          </div>

          <div className="repogrid">
            <div className="repogrid__main">
              {t.description && <p className="tok__desc">{t.description}</p>}

              <div className="pins pins--page">
                {/*
                  ⭐ `totalToProject` is DELIVERED money: the distributor deposits the project's
                  share into the GitVault under this launch's projectId in the same transaction as
                  the harvest. What this counts is sitting in the repo's treasury or already
                  claimed from it.
                */}
                <div className="pin">
                  <span className="pin__k">Delivered to the treasury</span>
                  <span className="pin__v">{fmt(t.paidToProject, t.pairDecimals, 2)} <small>{t.pairSymbol}</small></span>
                </div>
                <div className="pin">
                  <span className="pin__k">Still in the fee escrow</span>
                  <span className="pin__v">{fmt(t.pending, t.pairDecimals, 2)} <small>{t.pairSymbol}</small></span>
                  {/* ⛔ Never added to the figure beside it. Pons pays nothing until someone calls
                      harvest, so a combined total would be a promise dressed as a receipt. */}
                </div>
                <div className="pin">
                  <span className="pin__k">Market cap</span>
                  <span className="pin__v">{formatUsd(t.marketCapUsd) ?? '—'}</span>
                </div>
                <div className="pin">
                  <span className="pin__k">Repo cut of volume</span>
                  <span className="pin__v">{toProject.toFixed(3)}<small>%</small></span>
                </div>
              </div>

              <div className="panel" style={{ marginTop: 20 }}>
                <div className="signing__head">Fee distribution</div>
                <div className="signing__body">
                  {/* ⚠ The name when we can resolve it, the raw id when we cannot. An unresolvable
                      id is shown as an id rather than hidden: it is still the promise. */}
                  <Row k="Project" v={
                    project
                      ? <a href={projectPage(project)} target="_blank" rel="noreferrer">{project.name}</a>
                      : <span className="mono">{short(t.projectId, 8)}</span>
                  } />
                  {platformBps > 0 && <Row k="Platform fee" v={`${platformBps / 100}% of every fee, first`} />}
                  <Row k="Repo share" v={`${effectiveRepoPct(t.projectBps, platformBps)}% of every fee`} />
                  <Row k="Creator share" v={`${effectiveRepoPct(10000 - t.projectBps, platformBps)}% of every fee`} />
                  <Row k="Paid to the creator" v={`${fmt(t.paidToCreator, t.pairDecimals, 2)} ${t.pairSymbol}`} />
                  <Row k="Trading fee" v={`1%${t.creatorTaxBps ? ` plus ${(t.creatorTaxBps / 100).toFixed(2)}% creator tax` : ''}`} />
                  <div style={{ marginTop: 12 }}><SplitBar bps={t.projectBps} /></div>
                </div>
              </div>

              {/* ⛔ Only renders for a wallet that actually holds this token, so it is invisible to
                  everyone else rather than a disabled control everyone has to reason about. */}
              <BurnPanel token={t.address} symbol={t.symbol} decimals={t.decimals}
                onBurned={() => { void readToken(t.address).then((v) => v && setT(v)) }} />
            </div>

            <aside className="about">
              <h2 className="about__t">About</h2>
              {project && (
                <p className="about__repo">
                  <a href={projectPage(project)} target="_blank" rel="noreferrer">{project.name}</a>
                </p>
              )}
              <div className="about__rows">
                <Row k="Token" v={<a className="mono" href={tokenUrl(t.address)} target="_blank" rel="noreferrer">{short(t.address, 6)}</a>} />
                <Row k="Distributor" v={<a className="mono" href={addrUrl(t.distributor)} target="_blank" rel="noreferrer">{short(t.distributor, 6)}</a>} />
                <Row k="Curve" v={<a className="mono" href={addrUrl(t.curve)} target="_blank" rel="noreferrer">{short(t.curve, 6)}</a>} />
                <Row k="Launched by" v={<a className="mono" href={addrUrl(t.creator)} target="_blank" rel="noreferrer">{short(t.creator, 6)}</a>} />
                <Row k="Launched" v={when(t.launchedAt)} />
              </div>
            </aside>
          </div>
        </div>
      </section>
    </>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="trow">
      <span className="trow__k">{k}</span>
      <span className="trow__v">{v}</span>
    </div>
  )
}
