#!/usr/bin/env node
/**
 * Link a local deepseek-harness checkout into devDependencies so the SDK
 * packages (@deepseek-ai/*, unpublished at the time of writing) resolve for
 * type-checking and the test suite.
 *
 * Usage:
 *   node scripts/link-sdk.mjs [path/to/deepseek-harness]
 *   DSH_SDK_PATH=/path/to/deepseek-harness node scripts/link-sdk.mjs
 *
 * The script writes `link:` devDependencies into package.json and runs
 * `pnpm install`. It is additive: existing devDependencies are kept, and the
 * SDK links can be removed again with `pnpm unlink` / by dropping the
 * `link:` entries and re-installing. The production dependency surface of
 * the published bundle is untouched — @deepseek-ai/* are never declared as
 * runtime dependencies, because the web shell provides the platform modules
 * at runtime (see docs/publish).
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sdkRoot = resolve(process.env.DSH_SDK_PATH ?? process.argv[2] ?? join(repoRoot, '..', 'deepseek-harness'))

if (!existsSync(join(sdkRoot, 'package.json'))) {
  console.error(`[link-sdk] harness checkout not found at ${sdkRoot}`)
  console.error('[link-sdk] pass the path: node scripts/link-sdk.mjs /path/to/deepseek-harness')
  process.exit(1)
}

/** Walk a directory for package.json files without descending into node_modules. */
function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (entry === 'node_modules' || entry === '.git' || entry === 'lib') continue
    const st = statSync(abs)
    if (st.isDirectory()) {
      const pkg = join(abs, 'package.json')
      if (existsSync(pkg)) acc.push(pkg)
      else walk(abs, acc)
    }
  }
  return acc
}

const sdks = new Map()
for (const pkgPath of [...walk(join(sdkRoot, 'packages')), ...walk(join(sdkRoot, 'vendor'))]) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    if (typeof pkg.name === 'string' && pkg.name.startsWith('@deepseek-ai/')) {
      sdks.set(pkg.name, dirname(pkgPath))
    }
  } catch {
    // ignore unparseable manifests
  }
}
if (sdks.size === 0) {
  console.error(`[link-sdk] no @deepseek-ai packages found under ${sdkRoot}`)
  process.exit(1)
}

const manifestPath = join(repoRoot, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
manifest.devDependencies ??= {}
for (const [name, path] of [...sdks.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  manifest.devDependencies[name] = `link:${path}`
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`[link-sdk] linked ${sdks.size} SDK packages from ${sdkRoot}`)

const install = spawnSync('pnpm', ['install'], { cwd: repoRoot, stdio: 'inherit' })
process.exit(install.status ?? 1)
