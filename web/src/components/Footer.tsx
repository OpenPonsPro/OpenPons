import { addrUrl } from '../lib/chain.ts'
import { LAUNCHPAD, PONS_FACTORY, isLive } from '../lib/launchpad.ts'
import { GITHUB_URL, X_URL } from '../lib/brand.ts'
import { GithubIcon, XIcon } from './Header.tsx'

export function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr__grid">
          <div>
            <div className="ftr__brand">
              <span className="hdr__tile"><span className="mark"><img src="/mascot-cut.png" alt="" /></span></span>
              <span className="hdr__name">Open<span className="pons">Pons</span></span>
            </div>
            <p style={{ fontSize: '0.9rem', maxWidth: '36ch', margin: 0 }}>
              Fund open-source repos on Pons V2.
            </p>
          </div>

          <div>
            <h4>Site</h4>
            <div className="ftr__links">
              <a href="/launch">Launch</a>
              <a href="/explore">Explore</a>
              <a href="/how-it-works">How it works</a>
            </div>
          </div>

          <div>
            <h4>Contracts</h4>
            <div className="ftr__links">
              {isLive() && <a href={addrUrl(LAUNCHPAD)} target="_blank" rel="noreferrer">Launchpad</a>}
              <a href={addrUrl(PONS_FACTORY)} target="_blank" rel="noreferrer">Pons V2 factory</a>
              <a href="https://robinhoodchain.blockscout.com" target="_blank" rel="noreferrer">Explorer</a>
            </div>
          </div>

          {(X_URL || GITHUB_URL) && (
            <div>
              <h4>Elsewhere</h4>
              <div className="ftr__links">
                {X_URL && (
                  <a href={X_URL} target="_blank" rel="noreferrer noopener"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className="hdr__x" style={{ width: 18, height: 18 }}><XIcon /></span>
                    openpons
                  </a>
                )}
                {/* ⚠ Same shape as the X row above it: an 18px icon in a `.hdr__x` box, then the
                    handle. The two are one list, so they are built the same way rather than each
                    finding its own alignment. */}
                {GITHUB_URL && (
                  <a href={GITHUB_URL} target="_blank" rel="noreferrer noopener"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span className="hdr__x" style={{ width: 18, height: 18 }}><GithubIcon /></span>
                    openpons
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="ftr__legal">
          &copy; 2026 Open<span className="pons">Pons</span> &middot; MIT License &middot; Launches run on Pons V2; every split,
          deposit and claim is on chain. Not affiliated with GitHub.
        </div>
      </div>
    </footer>
  )
}
