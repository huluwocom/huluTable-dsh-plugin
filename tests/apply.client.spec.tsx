/** huluTable slot registration and its plain locale wiring. */
import { Context } from '@deepseek-ai/cordis'
import { vi, describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-hulutable/client'
import { HulutableController } from '../src/client/controller.ts'

// Grid/editor suites render the full blank canvas; coverage instrumentation slows
// them past the default 5s, so the file gets a generous ceiling.
vi.setConfig({ testTimeout: 20000 })

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  const slots = ctx.get('slots') as SlotRegistry
  if (declare) {
    // The sidebar shell declares the footer seat; simulate it minimally.
    slots.register(
      { name: 'root', children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
  }
  return { ctx, slots }
}

describe('ui-hulutable apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the workspace trigger into the sidebar footer seat', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entries = b.slots.entries('sidebar.footer.action')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('hulutable')
    expect(entries[0]!.locale).toBe('hulutable')
    expect(entries[0]!.options.label).toBeTypeOf('function')
  })

  it('exposes the inject face with a live controller and bound hook', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const entry = b.slots.entries('sidebar.footer.action')[0]!
    expect(entry.options.label()).toBeTypeOf('string')
    const injected = entry.inject()
    expect(injected).toBeDefined()
    expect((injected as { controller?: unknown }).controller).toBeInstanceOf(HulutableController)
    expect(typeof (injected as { useWorkspace?: unknown }).useWorkspace).toBe('function')
  })

  it('waits for a live owner declaration before registering (slots.inject semantics)', async () => {
    const b = await bench(false)
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    // No declaration yet: the injection waits, nothing is registered.
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
    // The sidebar shell declares the seat later; the pending injection runs.
    b.slots.register(
      { name: 'root', children: { 'sidebar.footer.action': { kind: 'list', scope: 'root' } } } as never,
      () => null,
    )
    const entries = b.slots.entries('sidebar.footer.action')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.id).toBe('hulutable')
  })

  it('removes the entry on teardown', async () => {
    const b = await bench()
    const fiber = b.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    await fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })
})
