const { spawnSync } = require('node:child_process')
const { readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

const roots = ['src', 'tests']

function collectTestFiles(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return []
    }
    throw error
  }

  return entries.flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return collectTestFiles(path)
    }
    if (!entry.isFile() && !statSync(path).isFile()) {
      return []
    }
    return path.endsWith('.test.ts') ? [path] : []
  })
}

const testFiles = roots.flatMap(collectTestFiles).sort()

if (testFiles.length === 0) {
  console.log('No web TypeScript test files found.')
  process.exit(0)
}

const tsxBin = process.platform === 'win32' ? 'tsx.cmd' : 'tsx'
const result = spawnSync(tsxBin, ['--test', ...testFiles], {
  stdio: 'inherit',
  shell: false,
})

if (result.error) {
  console.error(result.error)
  process.exit(1)
}

process.exit(result.status ?? 1)
