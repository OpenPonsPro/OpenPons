import { addrUrl, short } from '../lib/chain.ts'
import { LAUNCHPAD, PONS_FACTORY, isLive } from '../lib/launchpad.ts'
import { GIT_VAULT, vaultConfigured } from '../lib/gitVault.ts'
import { LAUNCH } from '../lib/router.ts'
import { Link } from './Link.tsx'

/**
 * The full explanation, and the page the rest of the site defers to.
 *
 * ⭐ The contract table is generated from the SAME constants the app transacts with, never typed
 * out. A transparency section listing an address the site does not actually use is worse than no
 * section: it reads as proof while pointing somewhere else. `LAUNCHPAD` in particular comes from the
 * build's env, so if the launchpad is ever redeployed this table follows it without an edit.
 */

const RHC = (a: string) => ({ href: addrUrl(a), label: short(a, 6) })

function ContractRow({ name, chain, what, link }: {
  name: React.ReactNode; chain: string; what: string; link: { href: string; label: string }
}) {
  return (
    <div className="ctr">
      <div className="ctr__id">
        <span className="ctr__name">{name}</span>
        <span className="ctr__chain">{chain}</span>
      </div>
      <p className="ctr__what">{what}</p>
      <a className="ctr__addr mono" href={link.href} target="_blank" rel="noreferrer noopener">{link.label}</a>
    </div>
  )
}

export function HowItWorksPage() {
  return (
    <section className="page">
      <div className="wrap">
        <div className="phead phead--page">
          <h1>How project tokens work</h1>
          <p className="phead__sub">
            Launch a token backed by a public GitHub repository. Its trading fees accrue for the
            people who maintain it, and every parameter is fixed onchain from the moment the token
            is created.
          </p>
        </div>

        <div className="tl">
          <div className="tl__item">
            <span className="tl__dot">1</span>
            <div className="tl__box">
              <h3>Launch a token for a repo</h3>
              <p>
                Paste a GitHub URL. Any public repository, no permission needed. Choose the paired
                asset and the fee split. One transaction launches the token and deploys its
                distributor; the repository&rsquo;s name is written into the launch itself, and none
                of it can be changed afterwards.
              </p>
            </div>
          </div>
          <div className="tl__item">
            <span className="tl__dot">2</span>
            <div className="tl__box">
              <h3>Every trade generates fees</h3>
              <p>
                Pons charges a 1% fee on every buy and sell. 70% of the creator-side fee goes to
                your distributor, giving the project a share of 0.70% of trading volume when the
                full creator-side fee is routed through the launch.
              </p>
            </div>
          </div>
          <div className="tl__item">
            <span className="tl__dot">3</span>
            <div className="tl__box">
              <h3>The distributor splits the fees</h3>
              <p>
                It takes the fees from escrow and splits them according to the percentage chosen
                when the token was launched.
              </p>
            </div>
          </div>
          <div className="tl__item">
            <span className="tl__dot">4</span>
            <div className="tl__box">
              <h3>The project&rsquo;s share accrues</h3>
              <p>
                The repository&rsquo;s share lands in an escrow under the repository&rsquo;s own
                name: the id recorded on chain is the slug itself, readable on any explorer. It
                grows with trading volume, and nobody, not the launcher and not us, can point it
                anywhere else.
              </p>
            </div>
          </div>
          <div className="tl__item">
            <span className="tl__dot">5</span>
            <div className="tl__box">
              <h3>The maintainer claims it</h3>
              <p>
                Whoever maintains the repository signs in with GitHub to prove it, connects a
                wallet, and unlocks 100% of what has accrued. Every launch, split and payout is
                recorded onchain, so the whole path is checkable by a stranger without trusting us.
              </p>
            </div>
          </div>
        </div>

        {/* ⭐ Generated from the constants the app transacts with, so it cannot drift from reality. */}
        <div className="phead phead--row" style={{ marginTop: 64 }}>
          <div>
            <h2>Contracts</h2>
            <p className="phead__sub">The addresses this site itself transacts with.</p>
          </div>
          <Link className="btn btn--ink" to={LAUNCH}>Launch a token</Link>
        </div>
        <div className="rowbox">
          {isLive() && (
            <ContractRow
              name={<>Open<span className="pons">Pons</span></>} chain="Robinhood Chain" link={RHC(LAUNCHPAD)}
              what="Deploys a distributor and launches the token in one transaction, and keeps the register of every launch."
            />
          )}
          {vaultConfigured() && (
            <ContractRow
              name="GitVault" chain="Robinhood Chain" link={RHC(GIT_VAULT)}
              what="Every repo's treasury, held under the repo's own name. Nothing leaves except a maintainer's claim."
            />
          )}
          <ContractRow
            name="Pons V2 factory" chain="Robinhood Chain" link={RHC(PONS_FACTORY)}
            what="Pons's own launch factory. It creates the token and the bonding curve, and holds the fee escrow."
          />
        </div>
      </div>
    </section>
  )
}
