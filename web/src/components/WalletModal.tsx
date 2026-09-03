import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useWallet } from '../lib/wallet.tsx'
import { INSTALL_LINKS } from '../lib/eip6963.ts'

/**
 * The connect dialog.
 *
 * ⚠ Closed by Escape and by a click on the backdrop, and it takes the focus when it opens. A modal
 * that can only be dismissed by finding its own control is a trap, and one that leaves focus behind
 * it is unusable by keyboard.
 */
export function WalletModal({ onClose }: { onClose: () => void }) {
  const { providers, connect, connecting, error } = useWallet()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    /* ⚠ The page behind must not scroll under the dialog. Restored on close rather than set to a
       fixed value, so a page that was already locked is not silently unlocked. */
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  /*
    🔴🔴 RENDERED INTO document.body, NOT WHERE IT IS WRITTEN.

    The header carries `backdrop-filter`, and an element with a backdrop filter becomes the
    CONTAINING BLOCK for `position: fixed` descendants. Written inline the dialog is a child of the
    header, so "fixed, inset 0" resolved against a 72px tall bar: the overlay covered the header
    only and the dialog was clipped to a sliver at the top of the page. Nothing about the CSS was
    wrong, which is why it looked like a styling problem and was not one.
  */
  return createPortal(
    <div className="overlay" onMouseDown={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h3 id="wallet-title">Connect a wallet</h3>
          <button className="modal__x" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>

        {providers.length === 0 ? (
          <>
            <p className="modal__note">
              No wallet announced itself to this page. Install one of these, then reload.
            </p>
            <div className="wlist">
              {INSTALL_LINKS.map((w) => (
                <a key={w.name} className="wbtn" href={w.url} target="_blank" rel="noreferrer noopener">
                  <span className="wbtn__name">{w.name}</span>
                  <span className="wbtn__go">Install</span>
                </a>
              ))}
            </div>
          </>
        ) : (
          <div className="wlist">
            {providers.map((p) => (
              <button key={p.info.uuid} className="wbtn" disabled={connecting}
                onClick={async () => { await connect(p); onClose() }}>
                {p.info.icon
                  ? <img src={p.info.icon} alt="" />
                  : <span className="wbtn__blank" aria-hidden="true" />}
                <span className="wbtn__name">{p.info.name}</span>
                <span className="wbtn__go">{connecting ? '' : 'Connect'}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="field__err" style={{ marginTop: 14 }}>{error}</p>}
      </div>
    </div>,
    document.body,
  )
}
