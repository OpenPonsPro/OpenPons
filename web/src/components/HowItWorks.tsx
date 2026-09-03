/**
 * The home page summary. The full explanation is the `/how-it-works` page, and this defers to it.
 *
 * ⚠⚠ Wrong copy about custody is worse than no copy about custody. This is a page about money
 * accruing for somebody else, and the first thing a sceptical reader checks is whether the site's
 * own account of itself matches what the contracts do. Every sentence here must survive that
 * check; anything that needs nuance belongs on `/how-it-works`.
 *
 * ⭐ Drawn as a commit timeline — a rail, numbered dots, one box per event — because the mechanism
 * IS a sequence, and this is the shape GitHub users already read sequences in.
 */
export function HowItWorks() {
  return (
    <section id="how" className="section--alt">
      <div className="wrap">
        <div className="phead">
          <h2>How a token funds its repo</h2>
          <p className="phead__sub">Three moves, every one of them on chain.</p>
        </div>

        <div className="tl">
          <div className="tl__item">
            <span className="tl__dot">1</span>
            <div className="tl__box">
              <h3>You launch</h3>
              <p>
                Paste a public GitHub URL. One transaction deploys the distributor and launches
                your token on Pons, with the repository's name and the fee split written in as
                constructor arguments, immutable from the first block.
              </p>
            </div>
          </div>

          <div className="tl__item">
            <span className="tl__dot">2</span>
            <div className="tl__box">
              <h3>Fees accrue for the repo</h3>
              <p>
                Pons charges a 1% fee on every buy and sell, with 0.70% going to the creator side.
                The project's share accumulates under the repository's own name, growing with
                every trade, and nobody can point it anywhere else.
              </p>
            </div>
          </div>

          <div className="tl__item">
            <span className="tl__dot">3</span>
            <div className="tl__box">
              <h3>The maintainer claims it</h3>
              <p>
                Whoever maintains the repository proves it by signing in with GitHub, connects a
                wallet, and unlocks everything that has accrued. Every payout is recorded onchain,
                a transparent trail from trades to the project they fund.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
