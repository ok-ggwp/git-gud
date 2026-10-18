// Build for publishing: compile src/ to dist/.
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = new URL('..', import.meta.url)
rmSync(new URL('dist', root), { recursive: true, force: true })
// typescript/package.json is exported; its bin (a node script) sits beside it.
const tsc = new URL('bin/tsc', pathToFileURL(createRequire(import.meta.url).resolve('typescript/package.json')))
execFileSync(process.execPath, [fileURLToPath(tsc), '-p', 'tsconfig.build.json'], { cwd: root, stdio: 'inherit' })
