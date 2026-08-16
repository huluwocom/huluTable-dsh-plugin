/** Node-half apply: deliberately empty host body. */
import { vi, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

describe('ui-hulutable node half', () => {
  it('mounts an empty host body', () => {
    apply()
    expect(true).toBe(true) // reaching here without throw is the contract
  })
})
