/**
 * The verifier: the second process that signs, and the one discretionary point in the system.
 *
 * ## What it is
 *
 * One endpoint. `POST /authorize {code, owner, repo, wallet, assets}` exchanges the GitHub OAuth
 * code, requires `permissions.admin` on the repo, and answers with an EIP-712 claim signature the
 * GitVault contract will accept. Stateless: no database, no sessions, no cookies — OAuth CSRF
 * (`state`) is the front end's to enforce.
 *
 * ## ⛔⛔ THE KEY
 *
 * `VERIFIER_KEY` is read from the environment, never written to a file, never logged. This key
 * can, mechanically, sign for any repo; it is named in the README as the one trusted piece, and
 * the vault's 48h rotation timelock is what bounds it. The same discipline as the keeper's key.
 *
 * ⚠ Loopback only, behind the reverse proxy, like `api/server.mjs`. Bound elsewhere this would be
 * a signing oracle on the open internet.
 */
import { createServer, type Server } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createPublicClient, http, isAddress, parseAbi, type Address, type Hex } from 'viem'
import { checkAdmin, type AdminCheck } from './github.ts'
import { projectIdFor } from './encode.ts'
import { signClaim } from './sign.ts'

const DEADLINE_S = 900

/* A public signing endpoint is a budget somebody else can spend. Same shape as the logo API's. */
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT = 30
const seen = new Map<string, number[]>()

export function rateLimited(who: string, now = Date.now(), limit = RATE_LIMIT): boolean {
  const hits = (seen.get(who) ?? []).filter((t) => t > now - RATE_WINDOW_MS)
  if (hits.length >= limit) { seen.set(who, hits); return true }
  hits.push(now)
  seen.set(who, hits)
  if (seen.size > 5000) {
    for (const [other, times] of seen) {
      if (other !== who && !times.some((t) => t > now - RATE_WINDOW_MS)) seen.delete(other)
    }
  }
  return false
}

const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/
const REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/

export type ServerCfg = {
  key: Hex
  chainId: number
  vault: Address
  checkAdminImpl: (args: { code: string; owner: string; repo: string }) => Promise<AdminCheck>
  readNonce: (projectId: Hex) => Promise<bigint>
  /**
   * The site origin allowed to call this service from a browser. Unset, no CORS headers are sent
   * — the deployment then MUST reverse-proxy /authorize onto the site's own origin. Never '*':
   * a signing oracle with a wildcard origin is a claim mint for any page a victim visits.
   */
  allowedOrigin?: string
}

const json = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

export function makeServer(cfg: ServerCfg): Server {
  return createServer((req, res) => {
    void (async () => {
      const path = (req.url ?? '').split('?')[0]
      /* ── CORS, single fixed origin. A JSON POST always preflights cross-origin. ── */
      if (cfg.allowedOrigin) {
        res.setHeader('Access-Control-Allow-Origin', cfg.allowedOrigin)
        res.setHeader('Vary', 'Origin')
        if (req.method === 'OPTIONS') {
          res.writeHead(204, {
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'content-type',
            'Access-Control-Max-Age': '600',
          })
          return res.end()
        }
      }
      if (req.method !== 'POST' || path !== '/authorize') return json(res, 404, { error: 'not-found' })
      if (rateLimited(req.socket.remoteAddress ?? '?')) return json(res, 429, { error: 'rate-limited' })

      let body: { code?: string; owner?: string; repo?: string; wallet?: string; assets?: string[] }
      try {
        const chunks: Buffer[] = []
        for await (const c of req) {
          chunks.push(c as Buffer)
          if (Buffer.concat(chunks).length > 16 * 1024) { req.destroy(); return }
        }
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch { return json(res, 400, { error: 'bad-json' }) }

      const { code, owner, repo, wallet, assets } = body
      /* ⛔ Shape-checked BEFORE anything external is called. A malformed wallet must never reach
         GitHub, let alone the signer. */
      if (!code || typeof code !== 'string' || code.length > 256) return json(res, 400, { error: 'bad-code' })
      if (!owner || !OWNER_RE.test(owner) || !repo || !REPO_RE.test(repo)) return json(res, 400, { error: 'bad-repo' })
      if (!wallet || !isAddress(wallet)) return json(res, 400, { error: 'bad-wallet' })
      if (!Array.isArray(assets) || assets.length === 0 || assets.length > 8 ||
          assets.some((a) => typeof a !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(a))) {
        return json(res, 400, { error: 'bad-assets' })
      }

      const check = await cfg.checkAdminImpl({ code, owner, repo })
      if (!check.ok) {
        const status = check.reason === 'not-found' ? 404 : check.reason === 'unreachable' ? 502 : 403
        return json(res, status, { error: check.reason })
      }

      const projectId = projectIdFor(check.slug)
      let nonce: bigint
      try { nonce = await cfg.readNonce(projectId) }
      catch { return json(res, 502, { error: 'chain-unreachable' }) }

      const deadline = BigInt(Math.floor(Date.now() / 1000) + DEADLINE_S)
      const claim = { projectId, to: wallet as Address, assets: assets as Address[], nonce, deadline }
      const signature = await signClaim(claim, cfg)
      return json(res, 200, {
        projectId, to: claim.to, assets: claim.assets,
        nonce: nonce.toString(), deadline: deadline.toString(), signature,
      })
    })().catch(() => json(res, 500, { error: 'internal' }))
  })
}

/* ── standalone entrypoint ─────────────────────────────────────────────────────────────────── */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const need = (name: string): string => {
    const v = process.env[name]
    if (!v) { console.error(`refusing to start: ${name} is not set`); process.exit(1) }
    return v
  }
  const key = need('VERIFIER_KEY') as Hex
  const clientId = need('GITHUB_CLIENT_ID')
  const clientSecret = need('GITHUB_CLIENT_SECRET')
  const vault = need('GIT_VAULT') as Address
  const rpc = process.env.RHC_RPC || 'https://rpc.mainnet.chain.robinhood.com'
  /* ⛔ 4663 IS ROBINHOOD CHAIN, and it is baked into the vault's EIP-712 domain: a signature
     minted for any other chain id is a BadSignature on chain, every time. */
  const chainId = Number(process.env.CHAIN_ID || 4663)
  const port = Number(process.env.PORT || 8804)

  const client = createPublicClient({ transport: http(rpc) })
  const abi = parseAbi(['function nonces(bytes32) view returns (uint256)'])

  const server = makeServer({
    key, chainId, vault,
    checkAdminImpl: (args) => checkAdmin(args, { clientId, clientSecret }),
    readNonce: (projectId) =>
      client.readContract({ address: vault, abi, functionName: 'nonces', args: [projectId] }),
    allowedOrigin: process.env.ALLOWED_ORIGIN || undefined,
  })
  // ⚠ The log line proves liveness and carries no secret — the same rule as the keeper's output.
  server.listen(port, '127.0.0.1', () => console.log(`openpons verifier on 127.0.0.1:${port}`))
}
