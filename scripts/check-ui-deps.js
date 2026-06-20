#!/usr/bin/env node
// Fails fast when src/ui/node_modules is absent or empty, preventing tsc -b from
// silently skipping the UI project and producing a false-green type-check result.
import { existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const uiModules = join(root, 'src', 'ui', 'node_modules')

const missing = !existsSync(uiModules)
const empty = !missing && readdirSync(uiModules).length === 0

if (missing || empty) {
  console.error(
    `\nERROR: src/ui/node_modules is ${missing ? 'missing' : 'empty'}.\n` +
    `Run:  npm --prefix src/ui ci\n` +
    `Then: npm run type-check\n`,
  )
  process.exit(1)
}
