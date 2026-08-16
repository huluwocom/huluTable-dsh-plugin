/**
 * huluTable plugin, node half.
 *
 * Deliberately empty: every behavior (the sidebar-foot trigger, the
 * full-viewport table workspace, IndexedDB persistence, the grid engine) is
 * browser-side. The node half exists so the package registers in the loader
 * graph like any other client plugin and carries the invariant companion.
 */

/** Host plugin body — nothing to mount on the host side. */
export function apply(): void {}
