# The keeper

A crank. Everything that moves money is enforced by the contracts; this process only pays the gas
that turns the handle.

```bash
# Dry run. This is the default and it signs nothing.
LAUNCHPAD=0x… node --experimental-strip-types src/keeper.ts

# Act. Any funded key will do — cranking is permissionless.
KEEPER_KEY=0x… LAUNCHPAD=0x… node --experimental-strip-types src/keeper.ts --send
```

## What it does

1. `sweepCurve` on each launch. **Permissionless**: the keeper runs it only because somebody has to.
2. `harvest` / `harvestToken`. Also permissionless — and this call DELIVERS: the distributor
   deposits the project's share into the `GitVault` under the launch's projectId, in the same
   transaction. There is nothing downstream of a harvest.

That is the whole job. There is no bridge, no shared payer, no ledger and no off-chain state; the
claim side (maintainer → vault) never touches this process at all.

## ⛔ The rules it enforces

- **`--send` is never the default.** A dry run simulates the same calls and prints what a pass
  would do.
- **A stock-paired launch is refused before it is harvested.** `_release` reverts `NotPayable` for
  anything but native ETH and USDG, so the contract cannot strand a stock — but the simulate-first
  loop would then skip it silently forever. `decide.ts` names the reason on every pass instead.
  The share stays in the Pons escrow, recoverable the day the sell path is driven.
- **Simulated first, always.** Both calls revert when there is nothing to do, which is the normal
  state of a quiet launch, and a reverted transaction still costs gas. A keeper polling quiet
  launches hourly with `try { write } catch {}` would burn real money doing nothing, forever.

## Gas the keeper needs

Sweep and harvest on Robinhood Chain cost fractions of a cent per launch per pass, and a launch
with nothing to move costs only two `eth_call`s. **0.05 ETH lasts a long time**; the health check
warns at 0.04 and pages at 0.015 (`ops/health-check.mjs`, `KEEPER_ADDR`).

## The sell path (`sell.ts`, written and not yet driven)

A launch paired against a tokenized stock earns fees no vault can hold: `_release` refuses them,
deliberately, because they could never leave the distributor once stuck in a contract with no
seller. `OpenPonsDistributor.sellAllForUsdg` converts a stock fee into USDG against the V4
singleton and splits the proceeds in the same transaction; `sell.ts` holds the tested tier
selection and tranching for the day the keeper drives it. Until then the keeper refuses
stock-paired launches before harvesting, which keeps every unit of their fees recoverable.

## What is proven

On a fork of live Robinhood Chain: a real launch through the real Pons factory, a real 8 ETH buy,
sweep, harvest, and the project's share arriving in the GitVault under its projectId — plus real
stock sales (AAPL, SPY, NVDA) through the real V4 singleton with the proceeds split and delivered.
See `contracts/test/{FeeFlow,LaunchpadFork,Fork}.t.sol`.
