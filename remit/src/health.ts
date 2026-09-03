/**
 * Is the launchpad actually delivering money, and if not, what stopped it?
 *
 * ## ⭐⭐ WHY THIS EXISTS
 *
 * On 29 Aug 2026 donations were halted for about forty minutes and nothing said so. The keeper's
 * refusal is a log line on a box nobody watches; the site kept serving, the timer kept firing, and
 * every pass ended by declining to send. It was found by a person going to look.
 *
 * ➤ The system is now complex enough that SILENT FAILURE is the main risk, not bugs. This module is
 * the smallest thing that turns the three states which have actually stopped money into something a
 * free uptime monitor can see.
 *
 * ## ⛔⛔ AN ALERT THAT CRIES WOLF IS WORSE THAN NO ALERT
 *
 * Every check here is written to be quiet during NORMAL operation. An unreadable input reports
 * `unknown` — never a fault, because a false alarm teaches somebody to ignore the next real one.
 *
 * ⛔ This module decides only. It never signs and never touches the keeper.
 */

export type Level = 'ok' | 'warn' | 'critical' | 'unknown'

export type Sample = {
  /** ms since the keeper last finished a pass successfully. `null` when unknown. */
  sinceLastRunMs: number | null
  /** Keeper gas on Robinhood Chain, wei. `null` when the chain could not be read. */
  keeperGasWei: bigint | null
}

export type Check = { id: string; level: Level; detail: string }

/* ── thresholds, all in one place so they can be argued with ─────────────────────────────────── */

/** ⚠ The timer is every 15 min. Three missed passes, not one: a single long pass is normal. */
export const STALE_WARN_MS = 45 * 60 * 1000
export const STALE_CRIT_MS = 90 * 60 * 1000

/**
 * ⚠ Measured 29 Aug: about 0.036 ETH/day under heavy delivery. The warn level is roughly a day of
 * warning and the critical level about ten hours, which is the point at which somebody has to act
 * rather than notice.
 */
export const GAS_WARN_WEI = 40_000_000_000_000_000n   // 0.04 ETH
export const GAS_CRIT_WEI = 15_000_000_000_000_000n   // 0.015 ETH

export function checkFreshness(s: Sample): Check {
  if (s.sinceLastRunMs === null) {
    return { id: 'keeper', level: 'unknown', detail: 'the last run time could not be read' }
  }
  const mins = Math.round(s.sinceLastRunMs / 60000)
  if (s.sinceLastRunMs >= STALE_CRIT_MS) {
    return { id: 'keeper', level: 'critical', detail: `no successful pass for ${mins} minutes` }
  }
  if (s.sinceLastRunMs >= STALE_WARN_MS) {
    return { id: 'keeper', level: 'warn', detail: `no successful pass for ${mins} minutes` }
  }
  return { id: 'keeper', level: 'ok', detail: `last pass ${mins} minutes ago` }
}

export function checkGas(s: Sample): Check {
  if (s.keeperGasWei === null) {
    return { id: 'gas', level: 'unknown', detail: 'Robinhood Chain could not be read' }
  }
  const eth = (Number(s.keeperGasWei) / 1e18).toFixed(6)
  if (s.keeperGasWei < GAS_CRIT_WEI) {
    return { id: 'gas', level: 'critical', detail: `${eth} ETH — the keeper stops when this empties, with no error anywhere` }
  }
  if (s.keeperGasWei < GAS_WARN_WEI) {
    return { id: 'gas', level: 'warn', detail: `${eth} ETH — top it up` }
  }
  return { id: 'gas', level: 'ok', detail: `${eth} ETH` }
}

/**
 * ⚠ `unknown` is NOT a fault. A monitor that goes red because a public RPC rate limited us would be
 * trained away within a week. It is surfaced in the body so a human reading the page can see it.
 */
export const WORST: Record<Level, number> = { ok: 0, unknown: 0, warn: 1, critical: 2 }

export function overall(checks: Check[]): Level {
  let worst: Level = 'ok'
  for (const c of checks) if (WORST[c.level] > WORST[worst]) worst = c.level
  if (worst === 'ok' && checks.some((c) => c.level === 'unknown')) return 'unknown'
  return worst
}

/** 200 while money can still move, 503 once something is actually stopping it. */
export const statusCode = (level: Level) => (level === 'critical' || level === 'warn' ? 503 : 200)

export function report(s: Sample, now = Date.now()) {
  const checks = [checkFreshness(s), checkGas(s)]
  const level = overall(checks)
  return { level, code: statusCode(level), checks, at: now }
}

/* ══ notifying a human ═══════════════════════════════════════════════════════════════════════════

   ⛔⛔ AN ALERT THAT REPEATS EVERY CHECK IS AN ALERT THAT GETS MUTED.

   The health check runs every five minutes. Posting on every unhealthy run would send twelve
   messages an hour for one fault, and the predictable result is a muted channel — which is worse
   than no alerting at all, because it looks like coverage.

   ➤ So a message is sent when the state CHANGES, and then at most once an hour while it persists.
   Recovery is announced once, because a fault that goes quiet is otherwise indistinguishable from
   one nobody fixed.
*/

/** How long before the same unresolved fault is repeated. */
export const RENOTIFY_MS = 60 * 60 * 1000

export type NotifyState = { level: Level; atMs: number } | null

export type NotifyDecision =
  | { send: false; reason: string }
  | { send: true; kind: 'raised' | 'worsened' | 'reminder' | 'recovered'; reason: string }

export function decideNotify(current: Level, previous: NotifyState, now = Date.now()): NotifyDecision {
  const bad = (l: Level) => l === 'warn' || l === 'critical'

  if (!bad(current)) {
    /* ⚠ `unknown` is not healthy enough to announce a recovery from: a rate limited RPC would send
       "recovered" while the fault was merely unobservable. Only a clean `ok` clears it. */
    if (previous && bad(previous.level) && current === 'ok') {
      return { send: true, kind: 'recovered', reason: 'the fault has cleared' }
    }
    return { send: false, reason: 'nothing wrong' }
  }

  if (!previous || !bad(previous.level)) {
    return { send: true, kind: 'raised', reason: 'a new fault' }
  }
  if (WORST[current] > WORST[previous.level]) {
    return { send: true, kind: 'worsened', reason: `escalated from ${previous.level}` }
  }
  if (now - previous.atMs >= RENOTIFY_MS) {
    return { send: true, kind: 'reminder', reason: 'still unresolved an hour later' }
  }
  return { send: false, reason: 'already reported, and not yet due a reminder' }
}

/**
 * The message body, shaped so ONE implementation covers the services people actually use.
 *
 * ⚠ Discord reads `content`, Slack and Mattermost read `text`. Sending both means a webhook URL can
 * be pasted in without anyone having to say which service it belongs to, and a generic endpoint
 * still receives readable JSON.
 */
export function alertBody(level: Level, kind: string, checks: Check[], url: string) {
  const mark = level === 'critical' ? '🔴' : level === 'warn' ? '🟠' : '🟢'
  const head = kind === 'recovered'
    ? `${mark} OpenPons recovered — money is moving again`
    : `${mark} OpenPons ${level.toUpperCase()}${kind === 'reminder' ? ' (still unresolved)' : ''}`
  const lines = checks
    .filter((c) => c.level === 'warn' || c.level === 'critical' || kind === 'recovered')
    .map((c) => `• ${c.id}: ${c.detail}`)
  const text = [head, ...lines, url].join('\n')
  return { content: text, text }
}
