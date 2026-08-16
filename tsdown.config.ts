/**
 * Self-contained build for the standalone distribution (no monorepo context).
 *
 * Mirrors the harness client-bundle preset:
 * - Node half: the (deliberately empty) host plugin body plus the invariant
 *   companion — plain ESM under lib/.
 * - Browser half: the whole table workspace, wrapped in
 *   `window.__ModuleLoader__.load({ id, factory })`. Platform modules (react,
 *   the UI slots/react/primitives seeds, cordis, the runtime store) stay
 *   external and are answered by the web shell's frozen module table at
 *   runtime; everything else (clsx/recharts/xlsx/…) is inlined. CSS Modules
 *   are compiled by lightningcss and auto-injected as a
 *   `<style data-plugin="dsh-hulutable-plugin">` tag.
 *
 * `pnpm prepare` runs this build, so `dsh plugin add github:<repo>` works
 * from source without prebuilt artifacts (transpile-only: no type-checking,
 * no project references — see docs/publish).
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** This package's bundle id (stamped on the loader handoff and style tags). */
const ID = 'dsh-hulutable-plugin'

/**
 * The specifiers the web shell shares into the frozen module table — never
 * bundled, resolved from `require()` at factory execution.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
] as const

/** Snapshot-store engine: a documented runtime exemption (see harness docs). */
const RUNTIME_STORE_EXEMPTION = '@deepseek-ai/dsh-client-runtime/client'

/** Everything else under @deepseek-ai must be inline-safe or is a build error. */
const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|session|llm|tools|brand)(\/|$)/
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

const CLIENT_EXTERNALS: readonly string[] = [...PLATFORM_MODULES, RUNTIME_STORE_EXEMPTION]

/** Virtual-id wrapper that keeps module CSS away from tsdown's own css pipeline. */
const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/** Minimal structural type for the two rollup-style plugins below. */
interface PluginLike {
  name: string
  resolveId?: (source: string, importer: string | undefined) => string | null
  load?: (id: string) => string | null | Promise<string | null>
}

/** Resolve a `.module.css` import against its importer (or a lib/types mirror). */
function sourceAssetPath(source: string, importer: string | undefined): string {
  const emitted = importer !== undefined ? resolvePath(dirname(importer), source) : source
  if (existsSync(emitted)) return emitted
  const marker = '/lib/types/'
  const boundary = emitted.indexOf(marker)
  if (boundary < 0) return emitted
  return resolvePath(emitted.slice(0, boundary), 'src', emitted.slice(boundary + marker.length))
}

/**
 * Bundle purity gate: platform seed entries stay external, inline-safe wire
 * layers inline, and every other @deepseek-ai VALUE import is a build error.
 * Type-only imports are erased before this gate ever sees them.
 */
const purityGate: PluginLike = {
  name: 'dsh-client-bundle-purity',
  resolveId(source: string) {
    if (!source.startsWith('@deepseek-ai/')) return null
    if (CLIENT_EXTERNALS.includes(source)) return null // platform module: external wins
    if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
    if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
    throw new Error(
      `client bundle purity: "${source}" is not a platform module (CLIENT_EXTERNALS), an inline-safe wire layer, or a generated /remote contribution — `
      + 'cross-plugin value imports are forbidden; collaborate through cordis services (type-only imports are erased and never reach this gate)',
    )
  },
}

/**
 * CSS Modules → hashed class map + one auto-injected <style> tag per
 * stylesheet. The loader removes plugin-owned tags on unload; re-evaluation
 * is idempotent.
 */
const cssModulesInline: PluginLike = {
  name: 'dsh-css-modules-inline',
  resolveId(source: string, importer: string | undefined) {
    if (!source.endsWith('.module.css')) return null
    const abs = importer !== undefined ? sourceAssetPath(source, importer) : source
    return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
  },
  load(virtualId: string) {
    if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
    const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
    const source = readFileSync(fileId)
    const { code, exports: cssExports } = transform({
      filename: fileId,
      code: source,
      cssModules: { pattern: '[hash]_[local]' },
      minify: true,
    })
    const classMap: Record<string, string> = {}
    for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
    return [
      `const css = ${JSON.stringify(code.toString())};`,
      `const tagId = ${JSON.stringify(`${ID}/${basename(fileId)}`)};`,
      'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
      '  const tag = document.createElement(\'style\');',
      `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
      '  tag.dataset.pluginCss = tagId;',
      '  tag.textContent = css;',
      '  document.head.appendChild(tag);',
      '}',
      `export default ${JSON.stringify(classMap)};`,
    ].join('\n')
  },
}

export default defineConfig([
  {
    // Node half: the host-side body (empty by design) and the invariant
    // companion. The harness auto-loads companions via the "./invariant"
    // export; this package owns no host behavior.
    name: ID,
    entry: ['src/index.ts', 'src/invariant.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: false,
    clean: false,
    outputOptions: {
      // package.json main/exports reference lib/index.js + lib/invariant.js;
      // entryFileNames pins the extension regardless of the source extension.
      entryFileNames: '[name].js',
    },
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...CLIENT_EXTERNALS],
    // The frozen module table answers only the platform entries above;
    // everything else must inline.
    noExternal: (id: string) => (CLIENT_EXTERNALS.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [purityGate, cssModulesInline],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
