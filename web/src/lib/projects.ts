import { keccak256, type Hex } from 'viem'

/**
 * A project is a public GitHub repository, and nothing else.
 *
 * ## ⭐⭐ THE ID *IS* THE REPO NAME, NOT A LOOKUP KEY
 *
 * The launch records a 32 byte `projectId` on chain. Where a typical launchpad stores an opaque
 * config id — meaningless without its private directory — this stores the repo slug itself:
 * `owner/repo`, lowercased, UTF-8, right-padded with zeros. Anybody with an explorer can read the
 * id and see the words. No directory, no API, no us.
 *
 * ⚠ A slug longer than 32 bytes cannot fit and falls back to `keccak256(slug)`. That id still
 * commits to exactly one repo but is no longer self-describing; the display falls back to the
 * short hex. Rare — `owner/repo` beyond 32 characters — and honest when it happens.
 *
 * ⛔ LOWERCASED BEFORE ENCODING, ALWAYS. GitHub treats `Vuejs/Core` and `vuejs/core` as the same
 * repository; two launches must never mint two different ids for one repo because of a shift key.
 */
export type Project = { slug: string; name: string; url: string }

const enc = new TextEncoder()

/** GitHub's own naming rules, loosely: they gate what the id can ever contain. */
const OWNER_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/
const REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}$/

/**
 * What the user typed, turned into a repo — or null.
 *
 * Accepts the full URL (`https://github.com/vuejs/core`, with or without protocol, `www.`, extra
 * path segments, a `.git` suffix) and the bare `owner/repo` shorthand. Anything that is not
 * plausibly a GitHub repo comes back null and the field says so; a malformed slug must never
 * reach the encoder.
 */
export function parseRepo(input: string): { owner: string; repo: string; slug: string } | null {
  let t = input.trim()
  if (!t) return null
  t = t.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
  if (/^github\.com\//i.test(t)) t = t.slice('github.com/'.length)
  else if (t.includes('.') && !t.includes('/')) return null
  const parts = t.split('/').filter(Boolean)
  if (parts.length < 2) return null
  const owner = parts[0]!
  const repo = (parts[1] ?? '').replace(/\.git$/i, '').split(/[?#]/)[0]!
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) return null
  return { owner, repo, slug: `${owner}/${repo}`.toLowerCase() }
}

/** The slug as bytes32: the words themselves when they fit, their hash when they cannot. */
export function projectIdFor(slug: string): Hex {
  const bytes = enc.encode(slug.toLowerCase())
  if (bytes.length > 32) return keccak256(bytes)
  const padded = new Uint8Array(32)
  padded.set(bytes)
  return ('0x' + Array.from(padded, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex
}

/**
 * The repo an on-chain id names, decoded straight off the chain — or null for the zero id, a
 * hashed overlong slug, or an id minted by something else entirely.
 *
 * ⚠ Printable ASCII with a `/` in it is the acceptance test. A keccak output that happens to pass
 * would need every one of its meaningful bytes inside 0x21–0x7E with a 0x2F among them; treating
 * that as impossible is the same bet every content-addressed system makes.
 */
export function projectFromId(id: string): Project | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(id) || /^0x0+$/.test(id)) return null
  const bytes: number[] = []
  for (let i = 2; i < 66; i += 2) bytes.push(parseInt(id.slice(i, i + 2), 16))
  let end = bytes.length
  while (end > 0 && bytes[end - 1] === 0) end--
  if (end === 0) return null
  const meaningful = bytes.slice(0, end)
  if (meaningful.some((b) => b < 0x21 || b > 0x7e)) return null
  const slug = String.fromCharCode(...meaningful)
  if (!slug.includes('/')) return null
  return { slug, name: slug, url: `https://github.com/${slug}` }
}

export const projectPage = (p: Project) => p.url

/** What the launch form shows before anything is signed: the repo, as GitHub describes it. */
export type RepoInfo = {
  /** `full_name` in GitHub's own casing — for display; the id is minted from the lowercased slug. */
  slug: string
  description: string
  stars: number
  avatarUrl: string
  homepage: string
  htmlUrl: string
}

export type RepoFetch =
  | { ok: true; repo: RepoInfo }
  | { ok: false; reason: 'not-found' | 'rate-limited' | 'unreachable' }

/**
 * One unauthenticated call to GitHub's public API.
 *
 * ⚠ 60 requests an hour per IP is the unauthenticated budget, so this is called when a typed repo
 * is confirmed (blur or Enter), never on every keystroke. The rate-limit answer is surfaced as its
 * own message — "try again in a bit" is actionable, "not found" for a repo that exists is a lie.
 */
export async function fetchRepo(owner: string, repo: string): Promise<RepoFetch> {
  let res: Response
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  if (res.status === 404) return { ok: false, reason: 'not-found' }
  if (res.status === 403 || res.status === 429) return { ok: false, reason: 'rate-limited' }
  if (!res.ok) return { ok: false, reason: 'unreachable' }
  const j = (await res.json()) as {
    full_name?: string; description?: string | null; stargazers_count?: number
    owner?: { avatar_url?: string }; homepage?: string | null; html_url?: string
  }
  if (!j.full_name) return { ok: false, reason: 'unreachable' }
  return {
    ok: true,
    repo: {
      slug: j.full_name,
      description: j.description ?? '',
      stars: j.stargazers_count ?? 0,
      avatarUrl: j.owner?.avatar_url ?? '',
      homepage: j.homepage ?? '',
      htmlUrl: j.html_url ?? `https://github.com/${j.full_name}`,
    },
  }
}
