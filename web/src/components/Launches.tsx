import type { Launch } from '../lib/launchpad.ts'
import { EXPLORE } from '../lib/router.ts'
import { Link } from './Link.tsx'
import { Ledger, applySort } from './LedgerSection.tsx'

/** ⚠ Six on the home page, not all of them. The home page is an introduction; the dashboard is the
 *  dashboard, and a home page that lists everything gives the dashboard nothing to be. */
const HOME_ROWS = 6

/**
 * Recent launches, newest first.
 *
 * ⭐ NO SORT CONTROL, AND THAT IS THE POINT. This is the recent launches panel: it answers "what has
 * just happened here", and a panel whose order can be changed is no longer answering that. Sorting
 * belongs on the explore page, which exists to be sorted. The order is fixed at newest so the
 * heading and the contents cannot disagree.
 */
export function Launches({ launches, loading }: { launches: Launch[]; loading: boolean }) {
  const rows = applySort(launches, 'newest').slice(0, HOME_ROWS)

  return (
    <section id="explore-preview">
      <div className="wrap">
        {/* ⭐ Left-aligned, like every list header on GitHub: title left, the "see all" action
            right, on the same line. */}
        <div className="phead phead--row">
          <div>
            <h2>Recent launches</h2>
            <p className="phead__sub">Newest first. The dashboard has the rest.</p>
          </div>
          {launches.length > HOME_ROWS && (
            <Link className="btn" to={EXPLORE}>See all {launches.length}</Link>
          )}
        </div>

        <Ledger rows={rows} loading={loading} empty="Nothing here yet. Launch the first one." />
      </div>
    </section>
  )
}
