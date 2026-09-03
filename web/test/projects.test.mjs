import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRepo, projectIdFor, projectFromId } from '../src/lib/projects.ts'

test('parseRepo accepts the bare shorthand', () => {
  assert.deepEqual(parseRepo('vuejs/core'), { owner: 'vuejs', repo: 'core', slug: 'vuejs/core' })
})

test('parseRepo accepts full URLs in their common shapes', () => {
  for (const input of [
    'https://github.com/vuejs/core',
    'http://github.com/vuejs/core',
    'github.com/vuejs/core',
    'www.github.com/vuejs/core',
    'https://github.com/vuejs/core.git',
    'https://github.com/vuejs/core/tree/main/packages',
  ]) {
    assert.equal(parseRepo(input)?.slug, 'vuejs/core', input)
  }
})

test('parseRepo lowercases the slug so one repo mints one id', () => {
  assert.equal(parseRepo('VueJS/Core')?.slug, 'vuejs/core')
})

test('parseRepo refuses what is not plausibly a GitHub repo', () => {
  for (const input of ['', 'vuejs', 'gitlab.com/x/y', 'https://example.com/a/b', 'a b/c', '-bad/repo', 'owner/..']) {
    assert.equal(parseRepo(input), null, JSON.stringify(input))
  }
})

test('a short slug rides in the id as its own bytes, and decodes back', () => {
  const id = projectIdFor('vuejs/core')
  assert.match(id, /^0x[0-9a-f]{64}$/)
  assert.deepEqual(projectFromId(id), {
    slug: 'vuejs/core', name: 'vuejs/core', url: 'https://github.com/vuejs/core',
  })
})

test('the id is case-stable', () => {
  assert.equal(projectIdFor('VueJS/Core'), projectIdFor('vuejs/core'))
})

test('a slug over 32 bytes falls back to a hash that does not decode', () => {
  const long = 'tailwindlabs/tailwindcss-intellisense'
  const id = projectIdFor(long)
  assert.match(id, /^0x[0-9a-f]{64}$/)
  /* The hash commits to the repo but is no longer self-describing. */
  assert.equal(projectFromId(id), null)
})

test('projectFromId refuses the zero id and garbage', () => {
  assert.equal(projectFromId('0x' + '0'.repeat(64)), null)
  assert.equal(projectFromId('0xdeadbeef'), null)
  /* printable but with no slash: not a repo */
  const noSlash = projectIdFor('x'.repeat(20)) // never produced by parseRepo, but defends the decoder
  assert.equal(projectFromId(noSlash), null)
})
