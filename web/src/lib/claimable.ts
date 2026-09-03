import type { Address } from 'viem'
import type { Launch } from './launchpad.ts'

/**
 * What a launcher can actually collect, and from which of their launches.
 *
 * ## ⛔⛔ A 100% PROJECT SPLIT PAYS THE LAUNCHER NOTHING, AND MOST LAUNCHES ARE 100%
 *
 * `OpenPonsDistributor` splits every fee at `projectBps` and pushes both halves. The launcher's side
 * is the remainder, `10000 - projectBps`, and it is paid to `opsVault`, the creator payout address
 * fixed at launch. The form defaults to a 100% project share, so for a typical launch here the
 * launcher's side is exactly zero no matter how much the token trades.
 *
 * ➤ So this page cannot list "your launches with fees". It has to list the launches with fees THAT
 * ARE YOURS, which is a different set, and it must say plainly that a 100% launch has a project
 * balance rather than showing a launcher a figure they cannot have.
 *
 * ## ⚠⚠ NOTHING HERE IS CLAIMED, IT IS PUSHED
 *
 * `harvest()` pulls from Pons's escrow and immediately calls `_release`, which sends the project
 * side to the vault and the launcher's side to `opsVault`. There is no balance sitting somewhere
 * waiting to be withdrawn to whoever calls, and the call is permissionless: pressing the button
 * pays out the same way whether the launcher, the project or a stranger presses it. The button is a
 * crank, not a withdrawal, and the copy has to say so or it reads as a claim on a balance.
 *
 * ⛔ It follows that the money lands at `opsVault`, which is NOT necessarily the connected wallet.
 * It was chosen at launch and cannot be changed. Showing "claim to your wallet" would be false for
 * any launcher who set it to a different address.
 */

export type Claimable = {
  launch: Launch
  /** Sitting in Pons's escrow, in the pair asset's base units. A harvest moves this. */
  pending: bigint
  /** The launcher's share of `pending`, at this launch's split. Zero at a 100% project split. */
  yours: bigint
  /** Where the launcher's share is pushed. Fixed at launch. */
  payout: Address
  /** True when this launch can never pay its launcher, because the project takes everything. */
  allToProject: boolean
}

/**
 * The launcher's side of an amount, at a given split.
 *
 * ⛔ Rounds the OPS side DOWN, exactly as the contract does, so this never promises a wei the
 * contract will not send. `OpenPonsDistributor._release` computes `toOps = amount * (10000 -
 * projectBps) / 10000` and gives the remainder to the project, deliberately, so that division dust
 * lands on the side without the keys. A UI that rounded the other way would show a figure one wei
 * above what arrives, every time, on every launch.
 */
export function launcherShare(amount: bigint, projectBps: number): bigint {
  if (amount <= 0n) return 0n
  const bps = BigInt(Math.max(0, Math.min(10_000, projectBps)))
  return (amount * (10_000n - bps)) / 10_000n
}

/** Launches created by this wallet, newest first. */
export function launchesBy(all: Launch[], who: string | null): Launch[] {
  if (!who) return []
  const w = who.toLowerCase()
  return all
    .filter((l) => l.creator.toLowerCase() === w)
    .sort((a, b) => (b.launchedAt > a.launchedAt ? 1 : b.launchedAt < a.launchedAt ? -1 : 0))
}

/**
 * Rows for the claim page.
 *
 * ⚠ Includes launches with nothing pending, so a launcher can see that the launch is theirs and
 * that it has earned nothing yet. Hiding them would make an empty page ambiguous between "you have
 * no launches" and "your launches have no fees", which are different problems with different fixes.
 */
export function claimableFor(all: Launch[], who: string | null, pendingBy: Map<string, bigint>): Claimable[] {
  return launchesBy(all, who).map((l) => {
    const pending = pendingBy.get(l.token.toLowerCase()) ?? 0n
    return {
      launch: l,
      pending,
      yours: launcherShare(pending, l.projectBps),
      payout: l.creator,
      allToProject: l.projectBps >= 10_000,
    }
  })
}

/** Only the rows where pressing the button actually moves something. */
export const worthCranking = (rows: Claimable[]): Claimable[] => rows.filter((r) => r.pending > 0n)

/** Totals per pair asset. ⛔ Never summed across assets; ether and dollars do not add. */
export function totalsByAsset(rows: Claimable[]) {
  const out = new Map<string, { symbol: string; decimals: number; yours: bigint; pending: bigint }>()
  for (const r of rows) {
    const k = r.launch.pairToken.toLowerCase()
    const cur = out.get(k) ?? { symbol: r.launch.pairSymbol, decimals: r.launch.pairDecimals, yours: 0n, pending: 0n }
    cur.yours += r.yours
    cur.pending += r.pending
    out.set(k, cur)
  }
  return [...out.values()].filter((v) => v.yours > 0n || v.pending > 0n)
}
