/**
 * The one question this service answers: does the person behind this OAuth code ADMIN that repo?
 *
 * ⛔⛔ THE USER'S TOKEN LIVES IN A LOCAL VARIABLE AND NOWHERE ELSE. It is never logged, never
 * echoed in an error, never stored. A verifier that leaks tokens is a worse hole than the one it
 * closes, and the tests assert the failure answers carry nothing.
 *
 * ⚠ `permissions.admin`, not membership: in an org, write access is common and the first claimer
 * takes 100% of the treasury — admin is the bar the founder chose (spec, 2026-08-30).
 *
 * ⚠ The slug returned is GitHub's own `full_name` for the repo the API RESOLVED — a renamed repo
 * redirects, and the current name is the answer. The id is minted from it, lowercased.
 */
export type AdminCheck =
  | { ok: true; slug: string }
  | { ok: false; reason: 'oauth' | 'not-admin' | 'not-found' | 'unreachable' }

export async function checkAdmin(
  { code, owner, repo }: { code: string; owner: string; repo: string },
  cfg: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch },
): Promise<AdminCheck> {
  const f = cfg.fetchImpl ?? fetch
  let token: string
  try {
    const res = await f('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: cfg.clientId, client_secret: cfg.clientSecret, code }),
    })
    const j = (await res.json()) as { access_token?: string; error?: string }
    if (!j.access_token) {
      /* ⚠ The reason CODE only — bad_verification_code, incorrect_client_credentials,
         redirect_uri_mismatch — never a token, never a secret. It names which credential is
         wrong, which is exactly what a 403 alone cannot. */
      console.log(`oauth exchange refused: ${j.error ?? 'no access_token in answer'}`)
      return { ok: false, reason: 'oauth' }
    }
    token = j.access_token
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  try {
    const res = await f(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    })
    if (res.status === 404) return { ok: false, reason: 'not-found' }
    if (!res.ok) return { ok: false, reason: 'unreachable' }
    const j = (await res.json()) as { full_name?: string; permissions?: { admin?: boolean } }
    if (!j.full_name) return { ok: false, reason: 'unreachable' }
    if (j.permissions?.admin !== true) return { ok: false, reason: 'not-admin' }
    return { ok: true, slug: j.full_name }
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
}
