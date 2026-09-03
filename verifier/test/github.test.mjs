import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkAdmin } from '../src/github.ts'

const TOKEN = 'gho_secret_test_token_do_not_leak'

/** A fetch double: first call is the OAuth exchange, second the repo read. */
function fakeFetch({ oauth, repoStatus, repoBody }) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).startsWith('https://github.com/login/oauth/access_token')) {
      return new Response(JSON.stringify(oauth), { status: 200 })
    }
    return new Response(JSON.stringify(repoBody ?? {}), { status: repoStatus ?? 200 })
  }
  return { impl, calls }
}

const CFG = { clientId: 'cid', clientSecret: 'sec' }

test('an admin gets a yes, with the slug GitHub answers', async () => {
  const { impl, calls } = fakeFetch({
    oauth: { access_token: TOKEN },
    repoBody: { full_name: 'VueJS/Core', permissions: { admin: true } },
  })
  const r = await checkAdmin({ code: 'c', owner: 'vuejs', repo: 'core' }, { ...CFG, fetchImpl: impl })
  assert.deepEqual(r, { ok: true, slug: 'VueJS/Core' })
  // The user token reached GitHub and nowhere else.
  assert.ok(calls[1].init.headers.Authorization.includes(TOKEN))
})

test('write access without admin is refused', async () => {
  const { impl } = fakeFetch({
    oauth: { access_token: TOKEN },
    repoBody: { full_name: 'vuejs/core', permissions: { admin: false, push: true } },
  })
  const r = await checkAdmin({ code: 'c', owner: 'vuejs', repo: 'core' }, { ...CFG, fetchImpl: impl })
  assert.deepEqual(r, { ok: false, reason: 'not-admin' })
})

test('a missing repo is not-found', async () => {
  const { impl } = fakeFetch({ oauth: { access_token: TOKEN }, repoStatus: 404 })
  const r = await checkAdmin({ code: 'c', owner: 'x', repo: 'y' }, { ...CFG, fetchImpl: impl })
  assert.deepEqual(r, { ok: false, reason: 'not-found' })
})

test('a refused code is an oauth failure, and the answer never carries a token', async () => {
  const { impl } = fakeFetch({ oauth: { error: 'bad_verification_code' } })
  const r = await checkAdmin({ code: 'c', owner: 'x', repo: 'y' }, { ...CFG, fetchImpl: impl })
  assert.deepEqual(r, { ok: false, reason: 'oauth' })
  assert.ok(!JSON.stringify(r).includes(TOKEN))
})

test('a network failure is unreachable, never a throw', async () => {
  const impl = async () => { throw new Error('ECONNRESET') }
  const r = await checkAdmin({ code: 'c', owner: 'x', repo: 'y' }, { ...CFG, fetchImpl: impl })
  assert.deepEqual(r, { ok: false, reason: 'unreachable' })
})
