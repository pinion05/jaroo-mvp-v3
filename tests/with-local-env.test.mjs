import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import withLocalEnv from '../scripts/with-local-env.cjs'

const { parseEnvFile, buildEnv } = withLocalEnv

test('parseEnvFile converts raw .env.cookie JSON into crawler cookie-file env aliases', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaroo-env-cookie-'))
  const cookiePath = path.join(tempDir, '.env.cookie')
  fs.writeFileSync(cookiePath, JSON.stringify([{ name: 'cmp_hist', value: 'x', domain: '.compglobal.wisereport.co.kr' }], null, 2))

  const env = parseEnvFile(cookiePath)
  assert.equal(env.WISEREPORT_GLOBAL_COOKIES_FILE, cookiePath)
  assert.equal(env.WISEREPORT_GLOBAL_COOKIE_FILE, cookiePath)
  assert.equal(env.COMPANY_GLOBAL_COOKIES_FILE, cookiePath)
  assert.equal(env.COMPANY_GLOBAL_COOKIE_FILE, cookiePath)
})

test('buildEnv overlays .env.local keys and raw .env.cookie aliases over existing process env', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jaroo-build-env-'))
  fs.writeFileSync(path.join(tempDir, '.env.local'), 'OPENROUTER_API_KEY=new-key\n')
  fs.writeFileSync(path.join(tempDir, '.env.cookie'), JSON.stringify([{ name: 'cmp_hist', value: 'x', domain: '.compglobal.wisereport.co.kr' }], null, 2))

  const previous = process.env.OPENROUTER_API_KEY
  process.env.OPENROUTER_API_KEY = 'old-key'
  try {
    const env = buildEnv(tempDir)
    assert.equal(env.OPENROUTER_API_KEY, 'new-key')
    assert.equal(env.WISEREPORT_GLOBAL_COOKIES_FILE, path.join(tempDir, '.env.cookie'))
  } finally {
    if (previous === undefined) {
      delete process.env.OPENROUTER_API_KEY
    } else {
      process.env.OPENROUTER_API_KEY = previous
    }
  }
})
