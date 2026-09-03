import { useRef, useState } from 'react'
import { fetchRepo, parseRepo, projectIdFor, type RepoInfo } from '../lib/projects.ts'

/**
 * Choosing who the money accrues for: a public GitHub repository.
 *
 * ⭐⭐ A REPO IS NAMED, NEVER VETTED. The predecessor of this field was a curated directory of
 * recipients with an address check and a confirmation tick, because an address can be wrong. A slug
 * cannot be wrong the same way: it either exists on GitHub or it does not, and the one call made
 * here settles which. What is recorded on chain is the slug itself (see `projects.ts`), so what
 * you see in the preview is byte for byte what the launch commits to.
 *
 * ⚠ The lookup fires when the typed repo is CONFIRMED — blur or Enter — never per keystroke.
 * Unauthenticated GitHub allows 60 requests an hour per IP; a debounce would still spend most of
 * them on prefixes of the final answer.
 */
export function GitHubRepoField({ onResolved, onCleared, error }: {
  /** A repo was fetched and is now what the launch pays. Fired with the id already minted. */
  onResolved: (r: { slug: string; projectId: string; repo: RepoInfo }) => void
  /** The input changed or failed: whatever the form held is no longer backed by anything. */
  onCleared: () => void
  error?: string
}) {
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [repo, setRepo] = useState<RepoInfo | null>(null)
  const [fail, setFail] = useState<string | null>(null)
  /* ⚠ A slow answer for a repo the user has already retyped over must not win. */
  const seq = useRef(0)

  async function resolve() {
    const parsed = parseRepo(raw)
    if (!parsed) {
      if (raw.trim()) setFail('That does not look like a GitHub repository. Try owner/repo or the full URL.')
      return
    }
    const mine = ++seq.current
    setBusy(true); setFail(null)
    const r = await fetchRepo(parsed.owner, parsed.repo)
    if (mine !== seq.current) return
    setBusy(false)
    if (!r.ok) {
      setRepo(null); onCleared()
      setFail(
        r.reason === 'not-found' ? 'No public repository by that name on GitHub.'
          : r.reason === 'rate-limited' ? 'GitHub is rate-limiting lookups from your connection. Try again in a few minutes.'
          : 'Could not reach GitHub to check that repository.',
      )
      return
    }
    setRepo(r.repo)
    onResolved({ slug: parsed.slug, projectId: projectIdFor(parsed.slug), repo: r.repo })
  }

  function edit(v: string) {
    setRaw(v)
    setFail(null)
    /* ⛔ Editing the slug orphans the preview and the id UNDER it, immediately. A form still
       holding the previous repo's id while the box says another repo is a mislaunch waiting for a
       signature. */
    if (repo) { setRepo(null); onCleared() }
  }

  return (
    <div className="field">
      <label className="field__l" htmlFor="repo">GitHub repository</label>
      <div className="tagin">
        <input id="repo" className="input mono" placeholder="vuejs/core or https://github.com/vuejs/core"
          value={raw} autoComplete="off" spellCheck={false}
          onChange={(e) => edit(e.target.value)}
          onBlur={() => { if (!repo) void resolve() }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void resolve() } }} />
        <button type="button" className="tagin__add" aria-label="Look this repository up"
          onClick={() => void resolve()} disabled={busy || !raw.trim()}>
          {busy ? '…' : '→'}
        </button>
      </div>

      {repo && (
        <div className="repocard">
          {repo.avatarUrl && <img className="repocard__img" src={repo.avatarUrl} alt="" />}
          <div className="repocard__body">
            <a className="repocard__name mono" href={repo.htmlUrl} target="_blank" rel="noreferrer noopener">
              {repo.slug}
            </a>
            {repo.description && <p className="repocard__desc">{repo.description}</p>}
            <span className="repocard__stars">★ {repo.stars.toLocaleString('en-US')}</span>
          </div>
        </div>
      )}

      {repo && (
        <p className="field__h">
          The repository name is written into the launch contract and cannot be changed afterwards.
        </p>
      )}
      {fail && <p className="field__err">{fail}</p>}
      {!fail && error && <p className="field__err">{error}</p>}
    </div>
  )
}
