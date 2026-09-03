import { useCallback, useEffect, useMemo, useState } from 'react'
import { type Address } from 'viem'
import { useWallet } from '../lib/wallet.tsx'
import { publicClient, txUrl } from '../lib/chain.ts'
import { DISTRIBUTOR_ABI, NATIVE_ADDRESS, fmtAmount, type Launch } from '../lib/launchpad.ts'
import { claimableFor, totalsByAsset, type Claimable } from '../lib/claimable.ts'
import { LAUNCH, MY_TOKENS, tokenHref } from '../lib/router.ts'
import { Link } from './Link.tsx'
import { TokenImage } from './TokenImage.tsx'

/**
 * Collecting the launcher's side of a launch's fees.
 *
 * ## ⛔⛔ NOTHING IS CLAIMED HERE, IT IS CRANKED
 *
 * `OpenPonsDistributor.harvest()` pulls from Pons's escrow and immediately releases: the project's
 * share goes to the vault and the launcher's share to `opsVault`, both pushed, in the same call. It
 * is **permissionless**, so this button pays out identically whether the launcher, the project or a
 * stranger presses it, and it pays the project whether or not the launcher has a share.
 *
 * ➤ So the copy never says "claim to your wallet". It says where the money goes, which is an
 * address fixed at launch that may not be the one connected. Calling it a claim on a balance would
 * be wrong in both directions: it is not a balance, and it is not necessarily yours.
 *
 * ## ⛔ A 100% PROJECT LAUNCH HAS NO LAUNCHER SIDE
 *
 * The launch form defaults to 100%, so this is the normal case rather than an edge one. Such a
 * launch is still shown, still cranked, and reported honestly as paying its project: showing a
 * launcher a claimable zero would read as a bug in the page rather than as the split they chose.
 */
export function ClaimFees({ launches, loading, onDone }: {
  launches: Launch[]; loading: boolean; onDone: () => void
}) {
  const { address, onRightChain, walletClient, switchChain } = useWallet()
  const [pendingBy, setPendingBy] = useState<Map<string, bigint>>(new Map())
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [done, setDone] = useState<{ token: string; hash: string } | null>(null)

  const mine = useMemo(() => claimableFor(launches, address, pendingBy), [launches, address, pendingBy])

  /* ⚠ `pending` is read fresh rather than taken from the register's snapshot. The register is
     fetched once when the app mounts; a launcher arriving here to collect wants the number as it is
     now, and it changes on every trade. */
  const refreshPending = useCallback(async (rows: Launch[]) => {
    if (rows.length === 0) return
    setReading(true)
    try {
      const entries = await Promise.all(rows.map(async (l) => {
        const p = await publicClient
          .readContract({ address: l.distributor, abi: DISTRIBUTOR_ABI, functionName: 'pending', args: [l.pairToken] })
          .catch(() => 0n)
        return [l.token.toLowerCase(), p] as const
      }))
      setPendingBy(new Map(entries))
    } finally { setReading(false) }
  }, [])

  useEffect(() => {
    const rows = launches.filter((l) => address && l.creator.toLowerCase() === address.toLowerCase())
    void refreshPending(rows)
  }, [launches, address, refreshPending])

  const totals = useMemo(() => totalsByAsset(mine), [mine])

  const crank = async (row: Claimable) => {
    if (!walletClient || !address) return
    setErr(null); setDone(null); setBusy(row.launch.token)
    try {
      const isNative = row.launch.pairToken.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
      /* ⚠⚠ SIMULATED FIRST. Both calls revert when there is nothing to move, which is the normal
         state for a launch nobody has traded, and a reverted transaction still costs gas. */
      /* ⚠⚠ `harvest` for a native launch, `harvestToken` for every other. Pons keeps two escrow
         ledgers and a launch lands in exactly one, so the wrong call SUCCEEDS and moves nothing.

         ⚠ Simulated and written inside each branch rather than picking a request with a ternary:
         the two have different argument types and viem cannot narrow the union, which is what the
         `as never` casts here were hiding. Those casts were also hiding that neither function was
         in the ABI at all. */
      const common = { address: row.launch.distributor, abi: DISTRIBUTOR_ABI, account: address } as const
      const hash = isNative
        ? await walletClient.writeContract(
            (await publicClient.simulateContract({ ...common, functionName: 'harvest' })).request,
          )
        : await walletClient.writeContract(
            (await publicClient.simulateContract({
              ...common, functionName: 'harvestToken', args: [row.launch.pairToken as Address],
            })).request,
          )
      await publicClient.waitForTransactionReceipt({ hash })
      setDone({ token: row.launch.symbol, hash })
      await refreshPending(mine.map((m) => m.launch))
      onDone()
    } catch (e) {
      const m = (e as Error)?.message ?? 'The transaction failed'
      /* ⚠ A user closing their wallet is not an error worth a red banner. */
      setErr(/User rejected|denied/i.test(m) ? null : m.split('\n')[0]!)
    } finally { setBusy(null) }
  }

  return (
    <section className="page">
      <div className="wrap">
        <div className="phead phead--page">
          <h1>Claim your fees</h1>
          <p className="phead__sub">The creator side of every launch this wallet made.</p>
        </div>

        {!address ? (
          <div className="empty">Connect a wallet to collect fees from the tokens it launched.</div>
        ) : mine.length === 0 ? (
          <div className="empty">
            This wallet has not launched anything yet.
            <div style={{ marginTop: 18 }}><Link className="btn btn--ink btn--lg" to={LAUNCH}>Launch a token</Link></div>
          </div>
        ) : (
          <>
            {totals.length > 0 && (
              <div className="claimbar">
                {totals.map((t) => (
                  <div className="claimbar__fig" key={t.symbol}>
                    <span className="claimbar__k">Your share</span>
                    <span className="claimbar__v">{fmtAmount(t.yours, t.decimals, 4)} {t.symbol}</span>
                  </div>
                ))}
              </div>
            )}

            {!onRightChain && (
              <div className="banner" style={{ marginBottom: 16 }}>
                <strong>This wallet is on another network.</strong>{' '}
                <button className="btn btn--sm" onClick={() => void switchChain()}>Switch to Robinhood Chain</button>
              </div>
            )}

            {err && <div className="banner" style={{ marginBottom: 16 }}><strong>{err}</strong></div>}
            {done && (
              <div className="banner" style={{ marginBottom: 16 }}>
                <strong>${done.token} collected.</strong>{' '}
                <a href={txUrl(done.hash)} target="_blank" rel="noreferrer noopener">View the transaction</a>
              </div>
            )}

            <div className="claims__list">
              {mine.map((row) => (
                <div className="claimrow" key={row.launch.token}>
                  <Link className="claimrow__tok" to={tokenHref(row.launch.token)}>
                    <TokenImage uri={row.launch.logo} symbol={row.launch.symbol} className="lrow__art" />
                    <span style={{ minWidth: 0 }}>
                      {/* ⚠ Ticker first, as on the launch cards, so a token is identified the same
                          way wherever it appears. */}
                      <span className="lrow__sym" style={{ display: 'block' }}>${row.launch.symbol}</span>
                      <span className="lrow__name">{row.launch.name}</span>
                    </span>
                  </Link>

                  <div className="claimrow__fig">
                    <span className="claimrow__k">In the escrow</span>
                    <span className="claimrow__v">
                      {reading ? '...' : `${fmtAmount(row.pending, row.launch.pairDecimals, 4)} ${row.launch.pairSymbol}`}
                    </span>
                  </div>

                  <div className="claimrow__fig">
                    <span className="claimrow__k">{row.allToProject ? 'Goes to' : 'Your share'}</span>
                    <span className="claimrow__v">
                      {row.allToProject
                        ? 'The project, all of it'
                        : `${fmtAmount(row.yours, row.launch.pairDecimals, 4)} ${row.launch.pairSymbol}`}
                    </span>
                  </div>

                  <button className="btn btn--sm" disabled={busy !== null || row.pending === 0n || !onRightChain}
                    onClick={() => void crank(row)}>
                    {busy === row.launch.token ? 'Collecting' : row.pending === 0n ? 'Nothing to collect' : 'Collect'}
                  </button>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20, textAlign: 'center' }}>
              <Link className="btn btn--sm" to={MY_TOKENS}>Back to my tokens</Link>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
