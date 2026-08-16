/**
 * Package-owned invariant companion for `dsh-hulutable-plugin`.
 * @module dsh-hulutable-plugin/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-hulutable-plugin'

/** Cordis companion plugin name. */
export const name = 'client-ui-hulutable-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: slot registrations are effects owned and observed by
 * the slot registry, and all table data lives in browser IndexedDB behind the
 * plugin's own store.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
