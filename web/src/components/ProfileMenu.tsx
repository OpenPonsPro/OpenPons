import { useEffect, useRef, useState } from 'react'
import { useWallet } from '../lib/wallet.tsx'
import { short } from '../lib/chain.ts'
import { CLAIM, MY_TOKENS, onNavClick } from '../lib/router.ts'

/**
 * The connected wallet menu.
 *
 * ⚠⚠ Everything here is a link, a read, or a disconnect. Nothing in this menu moves money, which is
 * deliberate: a header dropdown is the easiest thing on a page to open by accident, and it opens
 * over whatever somebody was doing. Launching is a form you fill in and a transaction you sign there.
 */
export function ProfileMenu({ onOpenPicker }: { onOpenPicker: () => void }) {
  const { address, onRightChain, disconnect, switchAccount, switchChain } = useWallet()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  /* ⚠ Closed by a click anywhere else and by Escape. A dropdown that only closes from its own
     trigger sits over the page while somebody tries to use what is underneath it. */
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!address) {
    return <button className="btn btn--ink btn--sm" onClick={onOpenPicker}>Connect</button>
  }

  const copy = () => {
    void navigator.clipboard.writeText(address).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className="profile" ref={box}>
      <button
        className={`btn btn--sm profile__trigger${open ? ' is-open' : ''}${onRightChain ? '' : ' is-warn'}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
      >
        <span className="profile__dot" aria-hidden="true" />
        <span className="mono">{short(address)}</span>
      </button>

      {open && (
        <div className="profile__menu" role="menu">
          <div className="profile__head">
            <span className="profile__addr mono">{short(address, 6)}</span>
            {/* ⚠ Beside the address rather than as a row below. Copying acts on the thing you are
                looking at, so it belongs next to it. */}
            <button className="profile__copy" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          </div>

          {!onRightChain && (
            <p className="profile__warn">
              This wallet is on another network. Reads are empty and launches fail until you switch.
            </p>
          )}

          {!onRightChain && (
            <button className="profile__item" role="menuitem" onClick={() => void switchChain()}>
              Switch to Robinhood Chain
            </button>
          )}

          {/* ⚠ Only the two destinations that are ABOUT this wallet. Launch and Explore are in the
              header already, and a dropdown that repeats the nav makes the reader check whether the
              two are different things. */}
          <a className="profile__item" role="menuitem" href={MY_TOKENS}
            onClick={(e) => { onNavClick(MY_TOKENS)(e); setOpen(false) }}>
            My Tokens
          </a>
          <a className="profile__item" role="menuitem" href={CLAIM}
            onClick={(e) => { onNavClick(CLAIM)(e); setOpen(false) }}>
            Claim Fees
          </a>

          {/* ⚠ Switching account inside MetaMask tells a site nothing: it keeps the account it has
              permission for, and `accountsChanged` never fires because the permission did not
              change. This re-opens the wallet's picker, which is the only way to move. It is here
              rather than behind Disconnect because disconnecting first was the workaround people
              were reaching for and it did not work either. */}
          <button className="profile__item" role="menuitem"
            onClick={() => { void switchAccount(); setOpen(false) }}>
            Switch wallet
          </button>

          <div className="profile__sep" />

          <button className="profile__item profile__item--danger" role="menuitem"
            onClick={() => { disconnect(); setOpen(false) }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
