#!/usr/bin/env node

const { spawn } = require('node:child_process')

const DEV_SCRIPTS = Object.freeze(['dev:web', 'dev:crawler'])
const SHUTDOWN_SIGNALS = new Set(['SIGINT', 'SIGTERM'])
const FORCE_KILL_SIGNAL = 'SIGKILL'

function getNpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'npm.cmd' : 'npm'
}

function getSignalExitCode(signal) {
  if (signal === 'SIGINT') {
    return 130
  }

  if (signal === 'SIGTERM') {
    return 143
  }

  return 1
}

function isMissingProcessError(error) {
  return typeof error === 'object' && error !== null && error.code === 'ESRCH'
}

function terminateChild(child, signal, options) {
  const { consoleImpl, platform, processImpl } = options

  if (child.exitCode != null) {
    return
  }

  if (platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0 && typeof processImpl.kill === 'function') {
    try {
      processImpl.kill(-child.pid, signal)
      return
    } catch (error) {
      if (!isMissingProcessError(error)) {
        consoleImpl.error(`[dev-stack] failed to stop child process group: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  try {
    child.kill(signal)
  } catch (error) {
    consoleImpl.error(`[dev-stack] failed to stop child process: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function runDevStack(options = {}) {
  const processImpl = options.processImpl || process
  const spawnImpl = options.spawnImpl || spawn
  const consoleImpl = options.consoleImpl || console
  const cwd = options.cwd || processImpl.cwd()
  const platform = options.platform || processImpl.platform
  const command = getNpmCommand(platform)
  const children = []
  const useProcessGroups = platform !== 'win32'
  let shuttingDown = false

  function stopChildren(signal) {
    for (const child of children) {
      terminateChild(child, signal, { consoleImpl, platform, processImpl })
    }
  }

  function shutdown(signal, exitCode, shutdownOptions = {}) {
    const { forceIfAlreadyShuttingDown = false } = shutdownOptions

    if (typeof exitCode === 'number' && processImpl.exitCode == null) {
      processImpl.exitCode = exitCode
    }

    if (shuttingDown) {
      if (forceIfAlreadyShuttingDown && SHUTDOWN_SIGNALS.has(signal)) {
        stopChildren(FORCE_KILL_SIGNAL)
      }

      return
    }

    shuttingDown = true
    stopChildren(signal)
  }

  for (const script of DEV_SCRIPTS) {
    const child = spawnImpl(command, ['run', script], {
      cwd,
      detached: useProcessGroups,
      env: processImpl.env,
      stdio: 'inherit',
    })

    children.push(child)

    child.on('error', (error) => {
      consoleImpl.error(`[dev-stack] ${script} failed to start: ${error instanceof Error ? error.message : String(error)}`)
      shutdown('SIGTERM', 1)
    })

    child.on('exit', (code, signal) => {
      child.exitCode = code
      child.signalCode = signal
      shutdown('SIGTERM', Number.isInteger(code) ? code : getSignalExitCode(signal))
    })
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    processImpl.on(signal, () => {
      shutdown(signal, getSignalExitCode(signal), { forceIfAlreadyShuttingDown: true })
    })
  }

  return children
}

if (require.main === module) {
  runDevStack()
}

module.exports = {
  DEV_SCRIPTS,
  getNpmCommand,
  getSignalExitCode,
  runDevStack,
}
