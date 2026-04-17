#!/usr/bin/env node

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {}
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  const values = {}

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const [, key, rawValue] = match
    let value = rawValue
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value.replace(/\\n/g, '\n')
  }

  return values
}

function buildEnv(cwd) {
  const merged = { ...process.env }
  for (const name of ['.env.local', '.env.cookie']) {
    const filePath = path.join(cwd, name)
    const values = parseEnvFile(filePath)
    for (const [key, value] of Object.entries(values)) {
      merged[key] = value
    }
  }
  return merged
}

const [, , command, ...args] = process.argv
if (!command) {
  console.error('[with-local-env] command is required')
  process.exit(1)
}

const child = spawn(command, args, {
  cwd: process.cwd(),
  env: buildEnv(process.cwd()),
  stdio: 'inherit',
  shell: false,
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})

child.on('error', (error) => {
  console.error(`[with-local-env] failed to start ${command}: ${error.message}`)
  process.exit(1)
})
