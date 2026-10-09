import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'

test('preview is read-only; generated auth denies requests; existing files survive', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'saemol-scaffold-'))
  const script = fileURLToPath(new URL('./scaffold.mjs', import.meta.url))
  try {
    const run = (...args) => spawnSync(process.execPath, [script, '--out', dir, ...args], { encoding: 'utf8', windowsHide: true })
    assert.equal(run('--framework', 'next').status, 0)
    assert.deepEqual(await readdir(dir), [])
    assert.equal(run('--framework', 'next', '--write').status, 0)
    const auth = await import(pathToFileURL(path.join(dir, 'lib/saemol/auth.mjs')).href)
    assert.equal(await auth.resolveUserId(new Request('https://example.test/?user=admin')), null)
    const route = await readFile(path.join(dir, 'app/api/saemol/webhook/route.js'), 'utf8')
    assert.match(route, /runtime = 'nodejs'/)
    await writeFile(path.join(dir, '.env.example'), 'KEEP-ME')
    assert.notEqual(run('--write').status, 0)
    assert.equal(await readFile(path.join(dir, '.env.example'), 'utf8'), 'KEEP-ME')
  } finally {
    if (!path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep + 'saemol-scaffold-')) throw new Error('Unsafe temporary cleanup path')
    await rm(dir, { recursive: true, force: true })
  }
})
