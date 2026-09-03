# OpenPons

Launch a token on [Pons](https://ponsfamily.com) V2 that funds the open-source project it is named
after — and let the maintainer, and nobody else, claim what accrues.

**Site:** [openpons.pro](https://openpons.pro) · **X:** [@OpenPons](https://x.com/OpenPons)

## What this is

OpenPons turns crypto speculation into direct funding for open-source developers. Anyone can launch
a token backed by a public GitHub repository — `vuejs/core`, `foundry-rs/foundry`, `shadcn/ui` —
without asking the authors first. The launchpad reuses Pons Family's factory and bonding curve
rather than rebuilding them; what OpenPons adds is where the fee goes and who can claim it.

1. **Permissionless launch.** Paste a GitHub URL. The app previews the repo from GitHub's public
   API and writes the `owner/repo` slug **itself** into the launch as the on-chain project id —
   readable off any explorer, hashed only past 32 bytes (`web/src/lib/projects.ts`).
2. **Passive accrual.** Every harvest deposits the project's share of the swap fees straight into
   the shared `GitVault` under that id, in the same transaction. No bridge, no custodial hop.
3. **Viral leverage.** As trading volume grows, so does the repo's treasury — visible on chain,
   attributable to the repo by name.
4. **Deferred claim.** A repo **admin** signs in with GitHub, connects a wallet, and one
   transaction sweeps 100% of the treasury to it. Claims are authorized by our verifier's EIP-712
   signature and by nothing else.

## Where the code stands today

⭐ **Deployed and proven end to end on Robinhood Chain.** The full cycle has run live: a token
launched against a real repository, real trading fees swept and harvested, the repo's share
deposited into the `GitVault` under the slug written in the launch, and the treasury claimed to
the maintainer's wallet on a GitHub-verified signature — `balances` back to zero, the lifetime
figure kept, the nonce bumped. The addresses are in the table below; every step is checkable on
the explorer.

The site is live at [openpons.pro](https://openpons.pro). Launches open when the official
announcement lands on [@OpenPons](https://x.com/OpenPons) — until then the pad is closed, and any
token claiming to be OpenPons is not ours.

## How the money moves

```
 trades (Pons curve) ──1%──► Pons fee escrow
         │  sweepCurve + harvest (keeper crank, permissionless)
         ▼
 OpenPonsDistributor            one per launch; immutable: projectId, split, vault, platform fee
         ├── platformBps ─────► platform vault        ── 10%, taken first, shown at launch
         ├── projectBps ──────► GitVault.deposit{value}(projectId)   ── of the rest; never a bare transfer
         └── remainder ───────► creatorPayout (the deployer)

 GitHub repo admin ── OAuth ──► verifier ── EIP-712 sig ──► GitVault.claim ──► 100% to their wallet
```

The repo's share of the post-platform rest is chosen at launch — between 50% and 100%, fixed
forever in the distributor's constructor.

**The trust statement.** The verifier's key can, mechanically, sign for any repo. That is the one
discretionary point in the system, it is named rather than hidden, and it is bounded by the vault's
48-hour rotation timelock being the only way to replace it. Everything else — splits, deposits,
claims paying 100% to the signed wallet — is immutable code: the vault has no withdraw, no pause,
no owner power beyond announcing a signer rotation two days in advance, publicly.

## Deployed contracts

| Contract | Chain | Address |
| --- | --- | --- |
| `GitVault` | Robinhood Chain | [`0xF979dd0bFabB6159bf13D14277bccA31D86dEEa3`](https://robinhoodchain.blockscout.com/address/0xF979dd0bFabB6159bf13D14277bccA31D86dEEa3) |
| `OpenPonsLaunchpad` | Robinhood Chain | [`0x3bC9a231E9F56351324daf6F9325a388797F09c0`](https://robinhoodchain.blockscout.com/address/0x3bC9a231E9F56351324daf6F9325a388797F09c0) |
| Pons V2 factory | Robinhood Chain | [`0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e`](https://robinhoodchain.blockscout.com/address/0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e) |

The vault's claim signer and owner are readable off the contract itself (`claimSigner()`,
`owner()`); the signer rotation timelock is 48 hours.

## Layout

| | |
| --- | --- |
| `contracts/` | Solidity, Foundry. `GitVault` (per-repo treasuries + claim), the launchpad, the per-launch distributor, and the V4 seller that converts tokenized-stock fees to USDG. |
| `remit/` | The keeper. A pure crank: sweep and harvest, nothing downstream. Permissionless — anyone can run one. |
| `verifier/` | The claim authorizer: GitHub OAuth → admin check → EIP-712 signature. Stateless, and it never stores or logs your token. |
| `web/` | The front end. A static React site that reads the chain in the visitor's browser. |

## Running it

```bash
# contracts. Fork tests need the loopback proxy (Cloudflare 403s forge's agent); they skip without it.
cd contracts && node scripts/rpc-proxy.mjs & forge test

# the keeper. A dry run is the default and signs nothing. ⚠ Node ≥ 22.6.
cd remit && npm i
LAUNCHPAD=0x… node --experimental-strip-types src/keeper.ts

# the verifier. Refuses to start without its env; see verifier/src/server.ts.
cd verifier && npm i && npm test

# the front end
cd web && npm i && npm run dev
```

`web/.env.production` carries `VITE_LAUNCHPAD`, `VITE_GIT_VAULT`, `VITE_VERIFIER_URL` and
`VITE_GITHUB_CLIENT_ID`. It is not in this repository, and neither is any key: the keeper reads
`KEEPER_KEY` and the verifier `VERIFIER_KEY` from their environments, never written to a file,
never logged, and never committed.

## Some things worth knowing

- **The site is static and has no backend for chain data**: Robinhood Chain blocks every ~100ms
  and the public RPC caps `eth_getLogs` at 2,000 blocks, so feeds are on-chain arrays and lifetime
  counters read with `eth_call` — the launchpad's register, the vault's `totalDeposited` — never
  event scans. The one genuine server need is the claim: GitHub authentication cannot happen in a
  constructor argument, and `verifier/` is the smallest thing that answers it.
- **Only ETH and USDG can be released to the vault,** and a launch paired against a tokenized
  stock therefore cannot pay its treasury yet. `contracts/src/V4Seller.sol` sells stock fees to
  USDG against the Uniswap V4 singleton and is proven on forked live pools — but nothing drives it
  yet, so the keeper refuses a stock-paired launch **before** harvesting it and the share stays
  recoverable in Pons's escrow. Not delayed by accident: `_release` reverts `NotPayable` on
  anything else, so the stranding bug is unreachable.
- **Pairing against USDG delivers more of every fee** than pairing against ETH once fees are sold
  to a stable — and the pair asset cannot be changed after launch.
- **A developer buy settles in the same transaction as the launch**, through Pons's periphery, so
  there is no intermediate state to trade against.
- **Nothing waits in the distributor.** `harvest()` pulls from the escrow and delivers both legs
  in the same call. The one balance that waits anywhere is the repo's treasury in the vault —
  waiting, by design, for its maintainer.

## Licence

MIT. See [LICENSE](LICENSE).
