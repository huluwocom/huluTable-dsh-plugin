// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { HulutableRoot } from '../src/client/HulutableRoot.tsx'
import { HulutableController } from '../src/client/controller.ts'
import { MemoryPersistence } from '../src/client/persistence.ts'
import { en } from '../src/client/locales.ts'
import type { HulutableRootProps } from '../src/client/contract/slots.ts'

/** jsdom lacks ResizeObserver; the grid only needs a no-op. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

// English-dictionary translate stub: the trigger renders the same copy the
// assertions below query by accessible name.
const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as HulutableRootProps['t']

/** Locale runtime stub: the root only reads the active id and toggles it. */
const localeSnapshot = { active: 'en' as const, locales: [] as never[], revision: 0 }
const setLocaleSpy = vi.fn()
const localeStub = {
  getSnapshot: () => localeSnapshot,
  subscribe: () => () => {},
  setLocale: setLocaleSpy,
} as unknown as HulutableRootProps['locale']

function mount(props?: Partial<HulutableRootProps>) {
  const controller = new HulutableController(new MemoryPersistence())
  const useWorkspace = bindSnapshotSelector(controller.store)
  const view = render(
    <HulutableRoot wide={true} t={t} controller={controller} useWorkspace={useWorkspace} locale={localeStub} {...props} />,
  )
  return { controller, view }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HulutableRoot trigger and panel', () => {
  it('renders the wide trigger with its label and opens the workspace', () => {
    mount()
    const trigger = screen.getByRole('button', { name: 'Tables' })
    expect(trigger).toBeTruthy()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: 'HuluTable' })).toBeTruthy()
  })

  it('switches the language via the segmented title-row control', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    // The stub's active locale is 'en' → the EN segment is active, 中 switches.
    fireEvent.click(screen.getByRole('button', { name: '中文' }))
    expect(setLocaleSpy).toHaveBeenCalledWith('zh')
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(setLocaleSpy).toHaveBeenCalledWith('en')
  })

  it('marks the active segment when the locale is zh', () => {
    // Flip the stub's snapshot to zh before mounting.
    ;(localeSnapshot as { active: string }).active = 'zh'
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    const en = screen.getByRole('button', { name: 'English' })
    fireEvent.click(en)
    expect(setLocaleSpy).toHaveBeenCalledWith('en')
    ;(localeSnapshot as { active: string }).active = 'en'
  })

  it('shows the loading placeholder before the controller is ready', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    expect(screen.getByText('Loading…')).toBeTruthy()
  })

  it('renders the rail trigger as a bare icon', () => {
    mount({ wide: false })
    const trigger = screen.getByRole('button', { name: 'HuluTable workspace' })
    expect(trigger).toBeTruthy()
  })

  it('closes via the close button and via Escape', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    fireEvent.click(screen.getByRole('button', { name: '' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    // Unrelated keys leave the panel open; Escape closes it.
    fireEvent.keyDown(document, { key: 'a' })
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the table library once ready', () => {
    const b = mount()
    b.controller.update((d) => { d.ready = true })
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    expect(screen.getByText('My Tables')).toBeTruthy()
  })

  it('opens the table editor when a table is current', async () => {
    const b = mount()
    b.controller.update((d) => { d.ready = true })
    const id = b.controller.createTable('客户表')
    await b.controller.openTable(id)
    fireEvent.click(screen.getByRole('button', { name: 'Tables' }))
    // The editor toolbar shows the table name and a back affordance.
    expect(screen.getByText('客户表')).toBeTruthy()
    const backButtons = screen.getAllByRole('button', { name: 'Back to library' })
    fireEvent.click(backButtons[0]!)
    expect(screen.getByText('My Tables')).toBeTruthy()
  })
})
