/**
 * huluTable workspace slot contract: the registrant-side inject face. The
 * trigger seat lives in the sidebar shell's SlotMap (ui-sidebar declares
 * `sidebar.footer.action`); this file owns only what this plugin contributes:
 * the controller (plain callbacks over workspace data) and the bound selector
 * hook over the controller's snapshot store.
 */
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsLocale, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { HulutableController, HulutableState } from '../controller.ts'

/** Registrant-injected business face. */
export interface HulutableRootInjected {
  /** The workspace controller: data reads and every mutation callback. */
  controller: HulutableController
  /** Selector hook over the workspace snapshot (bound in apply). */
  useWorkspace: SnapshotSelectorHook<HulutableState>
  /** The active-locale runtime (zh/en switch on the panel title row). */
  locale: LocaleRuntime
}

/** Full composed props: sidebar owner share + locale seat + injected face. */
export type HulutableRootProps =
  SidebarFooterActionOwnerProps
  & PropsLocale<'hulutable'>
  & HulutableRootInjected
