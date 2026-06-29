import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const root = process.cwd()
function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('account portfolio persistence migration uses Supabase auth RLS', () => {
  const migration = read('supabase/migrations/20260629083000_create_account_portfolio_holdings.sql')

  assert.match(migration, /create table if not exists public\.portfolio_holdings/)
  assert.match(migration, /references auth\.users\(id\) on delete cascade/)
  assert.match(migration, /alter table public\.portfolio_holdings enable row level security/)
  assert.match(migration, /user_id = auth\.uid\(\)/)
  assert.match(migration, /replace_portfolio_holdings\(p_items jsonb\)/)
})

test('home and merge screens connect account portfolio save and restore', () => {
  assert.match(read('src/components/home/jaroo-home-screen.tsx'), /fetchAccountPortfolioItems/)
  assert.match(read('src/components/home/jaroo-home-screen.tsx'), /router\.replace\('\/screenshot'\)/)
  assert.match(read('src/components/merge/jaroo-merge-screen.tsx'), /saveAccountPortfolioItems/)
  assert.equal(fs.existsSync(path.join(root, 'src/app/api/portfolio/route.ts')), true)
})
