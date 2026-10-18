#!/usr/bin/env node
// From a checkout, on a Node that runs TypeScript, use the source directly, so
// development needs no build; otherwise (an installed package, an older Node)
// the compiled JavaScript in dist/.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = new URL('../src/cli.ts', import.meta.url)
const dist = new URL('../dist/cli.js', import.meta.url)
if (!process.features.typescript && !existsSync(dist)) {
  console.error(`${process.argv[1]}: no build found; run \`npm run build\` in ${fileURLToPath(new URL('..', import.meta.url))}, or use Node 22.18+ to run the source`)
  process.exit(1)
}
const { main } = process.features.typescript && existsSync(src) ? await import(src.href) : await import(dist.href)
process.exitCode = await main(process.argv.slice(2))
