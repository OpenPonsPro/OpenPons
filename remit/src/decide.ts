/**
 * Which assets the distributor can release into the GitVault — the keeper's pre-harvest gate.
 *
 * ⛔⛔ THE CONTRACT ENFORCES THE SAME RULE HARDER. `OpenPonsDistributor._release` reverts
 * `NotPayable` for anything but native ETH and USDG, so a tokenized stock physically cannot reach
 * the vault. This table exists so the keeper refuses a stock-paired launch BEFORE harvesting,
 * loudly and with a reason, instead of a simulate-first loop skipping it in silence forever.
 *
 * ⭐ Stocks are SOLD FIRST, not banned. STOCK/USDG pools exist on the V4 singleton and
 * `OpenPonsDistributor.sellAllForUsdg` converts a stock fee into USDG on chain, splitting the
 * proceeds in the same transaction. See `sell.ts` for tier selection and tranching.
 *
 * ⚠ One residue remains and cannot be fixed off chain: a stock with no liquid pool at all — MSTR,
 * whose only initialised tier (`fee=100`) holds zero liquidity — waits in the distributor until
 * some pool for it has depth. Waiting is recoverable; stranding is not.
 */
export const RELEASABLE_ON_RHC: Record<string, string> = {
  '0x0000000000000000000000000000000000000000': 'ETH',
  '0x5fc5360d0400a0fd4f2af552add042d716f1d168': 'USDG',
}

export function canRelease(asset: string): boolean {
  return asset.toLowerCase() in RELEASABLE_ON_RHC
}
