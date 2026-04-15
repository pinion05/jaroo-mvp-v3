import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import launcherModule from '../scripts/dev-stack.cjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
const launcher = launcherModule

class FakeChild extends EventEmitter {
  constructor(name, pid) {
    super()
    this.name = name
    this.pid = pid
    this.kills = []
    this.killed = false
    this.exitCode = null
  }

  kill(signal) {
    this.kills.push(signal)
    this.killed = true
    return true
  }
}

class FakeProcess extends EventEmitter {
  constructor() {
    super()
    this.platform = 'linux'
    this.env = { PATH: process.env.PATH }
    this.exitCode = undefined
    this.killCalls = []
  }

  cwd() {
    return rootDir
  }

  kill(pid, signal) {
    this.killCalls.push({ pid, signal })
    return true
  }
}

test('root dev script launches the stack launcher instead of web-only dev', () => {
  assert.equal(packageJson.scripts.dev, 'node scripts/dev-stack.cjs')
})

test('root test script runs root smoke tests and key workspace package suites', () => {
  assert.equal(
    packageJson.scripts.test,
    'node --test tests/*.test.mjs && npm run test:crawler && npm run test:instrument-core',
  )
})

test('dev stack launcher starts both web and crawler dev scripts and stops siblings on exit', () => {
  const spawns = []
  const fakeProcess = new FakeProcess()
  const fakeChildren = new Map()

  launcher.runDevStack({
    cwd: rootDir,
    processImpl: fakeProcess,
    spawnImpl(command, args, options) {
      const child = new FakeChild(args[1])
      fakeChildren.set(args[1], child)
      spawns.push({ command, args, options, child })
      return child
    },
  })

  assert.deepEqual(
    spawns.map(({ command, args, options }) => ({ command, args, cwd: options.cwd, stdio: options.stdio })),
    [
      { command: 'npm', args: ['run', 'dev:web'], cwd: rootDir, stdio: 'inherit' },
      { command: 'npm', args: ['run', 'dev:crawler'], cwd: rootDir, stdio: 'inherit' },
    ],
  )

  fakeChildren.get('dev:web').emit('exit', 0, null)

  assert.deepEqual(fakeChildren.get('dev:crawler').kills, ['SIGTERM'])
  assert.equal(fakeProcess.exitCode, 0)
})

test('dev stack launcher forwards SIGINT to both child processes', () => {
  const fakeProcess = new FakeProcess()
  const fakeChildren = []

  launcher.runDevStack({
    cwd: rootDir,
    processImpl: fakeProcess,
    spawnImpl(_command, args) {
      const child = new FakeChild(args[1])
      fakeChildren.push(child)
      return child
    },
  })

  fakeProcess.emit('SIGINT')

  assert.deepEqual(fakeChildren.map((child) => child.kills), [['SIGINT'], ['SIGINT']])
  assert.equal(fakeProcess.exitCode, 130)
})

test('dev stack launcher escalates repeated shutdown signals to SIGKILL across child process groups', () => {
  const fakeProcess = new FakeProcess()
  const spawns = []

  launcher.runDevStack({
    cwd: rootDir,
    processImpl: fakeProcess,
    spawnImpl(_command, args, options) {
      const child = new FakeChild(args[1], spawns.length + 100)
      spawns.push({ child, options })
      return child
    },
  })

  fakeProcess.emit('SIGINT')
  fakeProcess.emit('SIGINT')

  assert.deepEqual(
    spawns.map(({ options }) => options.detached),
    [true, true],
  )
  assert.deepEqual(fakeProcess.killCalls, [
    { pid: -100, signal: 'SIGINT' },
    { pid: -101, signal: 'SIGINT' },
    { pid: -100, signal: 'SIGKILL' },
    { pid: -101, signal: 'SIGKILL' },
  ])
})
