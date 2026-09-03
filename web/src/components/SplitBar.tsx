/**
 * The split, drawn.
 *
 * ⭐⭐ The signature object of this site, and it appears in exactly two places on purpose: in the
 * launch form where a creator sets it, and on every token card where a buyer reads it. Same shape,
 * same colours, same proportions — so the promise made at launch and the promise displayed
 * afterwards are visibly the same promise.
 */
export function SplitBar({ bps, small = false }: { bps: number; small?: boolean }) {
  const pct = Math.max(0, Math.min(100, bps / 100))

  /*
    ⚠ Three states, because a two-state version clips. At 100% there is no creator side at all and
    the label was rendering into a 2px sliver as the word "or" — a caption that looks like a bug
    because it is one. Under a fifth of the bar the project legend has no room either, so both
    numbers move to the dark side: the exact split a sceptic is checking has to stay legible at
    every value, not just the comfortable middle.
  */
  const state = pct >= 99.5 ? 'all' : pct >= 22 ? 'roomy' : 'tight'
  const creatorPct = 100 - pct
  const fmt = (n: number) => (Number.isInteger(n) ? n : n.toFixed(1))

  return (
    <div className="split" role="img"
      aria-label={`${fmt(pct)}% to the project, ${fmt(creatorPct)}% to the creator`}>
      <div className={`split__a${small ? ' split__a--sm' : ''}`} style={{ width: `${pct}%` }}>
        {state !== 'tight' && <span>{fmt(pct)}% project</span>}
      </div>
      {state !== 'all' && (
        <div className="split__b">
          {state === 'roomy'
            ? `${fmt(creatorPct)}% creator`
            : `${fmt(pct)}% project · ${fmt(creatorPct)}% creator`}
        </div>
      )}
    </div>
  )
}
