import { useEffect, useMemo, useState } from 'react'
import { formatUnits, type Hex } from 'viem'
import { useWallet } from '../lib/wallet.tsx'
import { publicClient, txUrl } from '../lib/chain.ts'
import { NATIVE, USDG } from '../lib/pairs.ts'
import {
  GITHUB_CLIENT_ID, VERIFIER_URL, readTreasury, sendClaim, vaultConfigured,
  type ClaimAuthorization, type TreasuryRow,
} from '../lib/gitVault.ts'
import { GitHubRepoField } from './GitHubRepoField.tsx'
import { parseRepo, type RepoInfo } from '../lib/projects.ts'

/**
 * Where a maintainer takes their project's treasury out.
 *
 * ## The path, in order
 *
 * Sign in with GitHub → name the repo → see its treasury → connect a wallet → the verifier signs
 * an authorization for THIS wallet → one transaction sweeps 100% of every listed asset.
 *
 * ⛔⛔ THE OAUTH CODE IS SINGLE-USE AND THE PAGE TREATS IT THAT WAY. It is exchanged exactly once,
 * by the verifier, at the moment of the claim — never on page load. A failed claim after the
 * exchange burns the code, and the honest recovery is "sign in again", said plainly.
 *
 * ⚠ `state` is minted into sessionStorage before the redirect and checked on return. Without it,
 * a link crafted by someone else could hand this page an OAuth code the visitor never asked for.
 */

/** The assets a treasury can hold today: what `_release` can deliver. */
const CLAIM_ASSETS = [NATIVE, USDG]

const fmt = (v: bigint, d: number) =>
  Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 4 })
const assetMeta = (a: string) =>
  a.toLowerCase() === USDG.toLowerCase() ? { symbol: 'USDG', decimals: 6 } : { symbol: 'ETH', decimals: 18 }

/**
 * ⛔ Minted at CLICK TIME, never during render. Minting in the href regenerated the state on
 * every re-render — including the mount that handles GitHub's redirect back — so the page
 * overwrote the stored value moments before comparing it, and every sign-in "did not come back
 * the way it left". Found live, on the first real claim.
 */
function signIn() {
  const s = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
  try { sessionStorage.setItem('openpons.oauth.state', s) } catch { /* storage can be blocked; the login simply repeats */ }
  window.location.href = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&state=${s}`
}

export function ClaimRepo() {
  const { address, onRightChain, walletClient, switchChain } = useWallet()
  const [code, setCode] = useState<string | null>(null)
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [projectId, setProjectId] = useState<Hex | null>(null)
  const [treasury, setTreasury] = useState<TreasuryRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [doneTx, setDoneTx] = useState<Hex | null>(null)

  /* The return leg of the OAuth redirect: keep the code, check the state, clean the URL. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const c = q.get('code')
    if (!c) return
    let expected: string | null = null
    try { expected = sessionStorage.getItem('openpons.oauth.state') } catch { /* unreadable = no check possible */ }
    if (expected && q.get('state') !== expected) {
      setErr('The sign-in did not come back the way it left. Sign in again.')
    } else {
      setCode(c)
    }
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

  useEffect(() => {
    if (!projectId) { setTreasury(null); return }
    let live = true
    void readTreasury(projectId, CLAIM_ASSETS)
      .then((rows) => { if (live) setTreasury(rows) })
      .catch(() => { if (live) setTreasury([]) })
    return () => { live = false }
  }, [projectId])

  const claimable = useMemo(
    () => (treasury ?? []).filter((r) => r.balance > 0n),
    [treasury],
  )

  async function claim() {
    if (!code || !repo || !address || !walletClient) return
    setErr(null)
    try {
      setBusy('Asking GitHub who you are…')
      const parsed = parseRepo(repo.slug)
      const res = await fetch(`${VERIFIER_URL}/authorize`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code, owner: parsed?.owner, repo: parsed?.repo,
          wallet: address.toLowerCase(),
          assets: claimable.map((r) => r.asset),
        }),
      })
      /* ⛔ The code is spent now, whatever happens next. */
      setCode(null)
      if (!res.ok) {
        const reason = (await res.json().catch(() => ({})) as { error?: string }).error
        setErr(
          reason === 'not-admin' ? 'GitHub says you are not an admin of that repository.'
            : reason === 'not-found' ? 'GitHub could not find that repository with your account.'
            : reason === 'oauth' ? 'The sign-in expired. Sign in with GitHub again.'
            : 'The authorization failed. Sign in with GitHub again and retry.',
        )
        return
      }
      const auth = (await res.json()) as ClaimAuthorization

      setBusy('Confirm in your wallet…')
      const hash = await sendClaim(walletClient, auth)
      setBusy('Waiting for the block…')
      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') throw new Error('The claim transaction reverted.')
      setDoneTx(hash)
      setTreasury(null)
    } catch (e) {
      const m = (e as Error).message ?? ''
      setErr(
        /User rejected|denied/i.test(m) ? 'You cancelled the signature. Nothing was signed. Sign in with GitHub again to retry.'
          : /Expired/.test(m) ? 'The authorization ran out before the transaction was sent. Sign in again.'
          : 'Could not complete the claim. Nothing left the treasury. Sign in with GitHub again to retry.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (doneTx) {
    return (
      <section className="page">
        <div className="wrap wrap--form">
          <div className="phead phead--page">
            <h1>The treasury is <span className="hl">yours</span></h1>
            <p className="phead__sub">
              Fees keep accruing as the repo&rsquo;s tokens trade. Come back any time: each claim
              sweeps everything that has arrived since the last one.
            </p>
          </div>
          <div className="panel panel--pad">
            <div className="kv"><span className="kv__k">Repository</span>
              <span className="kv__v mono">{repo?.slug}</span></div>
            <div className="kv"><span className="kv__k">Transaction</span>
              <a className="kv__v mono" href={txUrl(doneTx)} target="_blank" rel="noreferrer">View</a></div>
          </div>
        </div>
      </section>
    )
  }

  /*
    ⭐ A stepper on the same timeline rail the home page uses: sign in, name the repo, claim. The
    whole flow is visible at once, so nobody wonders what comes after the button they are on.
  */
  return (
    <section className="page">
      <div className="wrap wrap--form">
        <div className="phead phead--page">
          <h1>Claim your repo&rsquo;s treasury</h1>
          <p className="phead__sub">
            Prove you maintain the repository by signing in with GitHub, and everything it has
            earned is paid to your wallet in one transaction.
          </p>
        </div>

        {!vaultConfigured() && (
          <div className="banner" style={{ marginBottom: 26 }}>
            <strong>Claims are not open yet.</strong> The treasury vault is not live, so there is
            nothing to claim from.
          </div>
        )}

        <div className="tl">
          <div className={`tl__item${code ? ' tl__item--done' : ''}`}>
            <span className="tl__dot">{code ? '✓' : '1'}</span>
            <div className="tl__box">
              <h3>Sign in with GitHub</h3>
              <p>
                GitHub vouches for you. Admin permission on the repository is what unlocks its
                treasury; nothing else does.
              </p>
              {!code && (
                GITHUB_CLIENT_ID ? (
                  <button type="button" className="btn btn--ink" onClick={signIn}>
                    Sign in with GitHub
                  </button>
                ) : (
                  <div className="banner" style={{ margin: 0 }}>Sign-in is not configured on this deployment.</div>
                )
              )}
              {code && <p className="field__h" style={{ margin: 0 }}>Signed in. The authorization is used once, at the claim.</p>}
            </div>
          </div>

          <div className={`tl__item${!code ? ' tl__item--off' : repo ? ' tl__item--done' : ''}`}>
            <span className="tl__dot">{repo ? '✓' : '2'}</span>
            <div className="tl__box">
              <h3>Name the repository</h3>
              {code ? (
                <>
                  <GitHubRepoField
                    onResolved={(v) => { setRepo(v.repo); setProjectId(v.projectId as Hex) }}
                    onCleared={() => { setRepo(null); setProjectId(null) }}
                  />
                  {repo && treasury && (
                    claimable.length === 0 ? (
                      <p className="field__h">This repository&rsquo;s treasury is empty right now.</p>
                    ) : (
                      claimable.map((r) => {
                        const m = assetMeta(r.asset)
                        return (
                          <div className="kv" key={r.asset}>
                            <span className="kv__k">Claimable</span>
                            <span className="kv__v">{fmt(r.balance, m.decimals)} {m.symbol}</span>
                          </div>
                        )
                      })
                    )
                  )}
                </>
              ) : (
                <p>Any public repository you admin, typed here and checked against GitHub.</p>
              )}
            </div>
          </div>

          <div className={`tl__item${!code || !repo ? ' tl__item--off' : ''}`}>
            <span className="tl__dot">3</span>
            <div className="tl__box">
              <h3>Claim to your wallet</h3>
              <p>One transaction sweeps 100% of every asset the treasury holds.</p>
              {err && <p className="field__err" style={{ marginTop: 0 }}>{err}</p>}
              {!address ? (
                <div className="banner" style={{ margin: 0 }}>Connect a wallet to receive the funds.</div>
              ) : !onRightChain ? (
                <button className="btn" onClick={() => void switchChain()}>Switch to Robinhood Chain</button>
              ) : (
                <button className="btn btn--ink"
                  disabled={!code || !repo || claimable.length === 0 || !!busy || !vaultConfigured()}
                  onClick={() => void claim()}>
                  {busy ?? 'Claim everything to this wallet'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
