/**
 * huluTable plugin, browser half: the sidebar-foot trigger and the
 * full-viewport table workspace. Registers the `hulutable` dictionaries and
 * one `sidebar.footer.action` list entry (the sidebar shell declares that
 * seat; ui-settings-general registers its settings neighbor), so the trigger
 * renders beside Settings in both sidebar widths and opens the workspace
 * panel. The workspace controller (IndexedDB persistence, undo, history)
 * is created here and handed to the panel through the register inject face.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls ui-sidebar's SlotMap merge ('sidebar.footer.action') so
// the owner props resolve in this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { HulutableRootInjected } from './contract/slots.ts'
import { HulutableController } from './controller.ts'
import { HulutableRoot } from './HulutableRoot.tsx'
import { en, zh, type HulutableKey } from './locales.ts'
import { IndexedDbPersistence } from './persistence.ts'

export type { HulutableKey } from './locales.ts'
export type { HulutableState, HulutableController, CellSelection } from './controller.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** huluTable workspace copy. */
    hulutable: HulutableKey
  }
}

/** Dictionary namespace owned by this plugin (workspace copy). */
const NS = 'hulutable'

/** Required services: the slot registry and the workspace dictionaries. */
export const inject = ['slots', 'locale']

/**
 * Register the `hulutable` dictionaries and the workspace trigger. The footer
 * seat is declared by the sidebar shell, so the registration waits on it via
 * `slots.inject` (activation order is unconstrained).
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-hulutable: dictionaries')

  // The controller owns all workspace data; the panel reaches it through the
  // inject face (controller callbacks + a bound selector hook over its store).
  const controller = new HulutableController(new IndexedDbPersistence())
  void controller.init()
  const useWorkspace = bindSnapshotSelector(controller.store)

  ctx.slots.inject('sidebar.footer.action', () => {
    const t = ctx.locale.bind(NS)
    const injected = (): HulutableRootInjected => ({ controller, useWorkspace, locale: ctx.locale })
    return ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'hulutable',
      order: 0,
      label: () => t('action.label'),
      locale: NS,
      inject: injected,
    }, HulutableRoot)
  })

  // The controller's pagehide flush outlives the registration; dispose it
  // with this plugin's fiber so reloads never stack flush timers.
  ctx.effect(() => () => { controller.dispose() }, 'ui-hulutable: controller teardown')
}
