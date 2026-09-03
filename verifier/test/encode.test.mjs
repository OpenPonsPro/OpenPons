import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectIdFor } from '../src/encode.ts'

// ⛔ These expectations are shared with web/test/projects.test.mjs on purpose: the two
// implementations must mint the same id for the same repo, forever.

test('a short slug rides in the id as its own bytes', () => {
  assert.equal(
    projectIdFor('vuejs/core'),
    '0x7675656a732f636f726500000000000000000000000000000000000000000000',
  )
})

test('the id is case-stable', () => {
  assert.equal(projectIdFor('VueJS/Core'), projectIdFor('vuejs/core'))
})

test('a slug over 32 bytes falls back to keccak', () => {
  const id = projectIdFor('tailwindlabs/tailwindcss-intellisense')
  assert.match(id, /^0x[0-9a-f]{64}$/)
  // keccak output: no trailing zero padding pattern of an ascii encoding
  assert.notEqual(id.slice(2, 4), Buffer.from('t').toString('hex'))
})
