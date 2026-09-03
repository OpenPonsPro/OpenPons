import { keccak256 } from 'viem'
import type { Hex } from 'viem'

/**
 * `owner/repo` → bytes32 projectId.
 *
 * ⛔ BYTE FOR BYTE THE RULE IN `web/src/lib/projects.ts`, and pinned to it by shared test vectors:
 * lowercase the slug, UTF-8 it, right-pad to 32 bytes when it fits, keccak256 when it does not.
 * Two implementations minting different ids for one repo is money credited to a treasury nobody
 * can claim, so any change here must land in both files and both test suites in the same commit.
 */
const enc = new TextEncoder()

export function projectIdFor(slug: string): Hex {
  const bytes = enc.encode(slug.toLowerCase())
  if (bytes.length > 32) return keccak256(bytes)
  const padded = new Uint8Array(32)
  padded.set(bytes)
  return ('0x' + Array.from(padded, (b) => b.toString(16).padStart(2, '0')).join('')) as Hex
}
