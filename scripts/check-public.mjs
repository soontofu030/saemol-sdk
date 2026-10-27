import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const failures = []
const gitFiles = args => execFileSync('git', ['ls-files', '-z', ...args], {
  cwd: root, encoding: 'utf8', windowsHide: true,
}).split('\0').filter(Boolean)
const readJson = name => JSON.parse(readFileSync(new URL('../' + name, import.meta.url), 'utf8'))
const manifest = readJson('package.json')
const lock = readJson('package-lock.json')

if (manifest.version !== lock.version || manifest.version !== lock.packages?.['']?.version) {
  failures.push('package.json and package-lock.json versions differ')
}

const rootFiles = new Set([
  '.gitignore', '.npmignore', '.gitattributes', 'LICENSE', 'README.md', 'CHANGELOG.md', 'SECURITY.md',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.cjs.json', 'tsconfig.esm.json',
])
const scripts = new Set([
  'postbuild.mjs', 'cli.mjs', 'doctor.mjs', 'scaffold.mjs', 'scaffold.verify.mjs',
  'self-test.mjs', 'check-public.mjs',
])
const examples = new Set([
  'adapters.mjs', 'handlers.mjs', 'server.mjs', 'store.mjs', 'store.verify.mjs',
  'README.md', 'inicis.md', 'portone.md', // retired documentation redirect; excluded from npm files
])
const publicPath = name => rootFiles.has(name)
  || /^src\/[a-z][a-z0-9-]*(?:\.test)?\.ts$/.test(name)
  || name === '.github/workflows/ci.yml'
  || name === '.githooks/pre-push'
  || name.startsWith('scripts/') && scripts.has(name.slice('scripts/'.length))
  || name.startsWith('examples/checkout-service/') && examples.has(name.slice('examples/checkout-service/'.length))

for (const name of gitFiles(['--cached', '--ignored', '--exclude-standard'])) {
  failures.push(`Ignored file is still tracked: ${name}`)
}

// Examine only files eligible for publication. Never read real ignored env files.
const files = new Set(gitFiles(['--cached', '--others', '--exclude-standard']))
const sensitiveContent = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['personal machine path', /(?:[A-Za-z]:[\\/]+Users[\\/]+[A-Za-z0-9_.-]+|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/)/],
]
for (const name of files) {
  if (!publicPath(name)) {
    failures.push(`Unexpected public file: ${name}`)
    continue
  }
  const content = readFileSync(new URL('../' + name, import.meta.url), 'utf8')
  for (const [label, pattern] of sensitiveContent) {
    if (pattern.test(content)) failures.push(`${label} detected in ${name}`)
  }
}

const packIndex = process.argv.indexOf('--pack')
if (packIndex !== -1) {
  const packPath = process.argv[packIndex + 1]
  if (!packPath) throw new Error('--pack requires an npm pack --dry-run --json report')
  const [packed] = JSON.parse(readFileSync(packPath, 'utf8'))
  if (packed?.name !== manifest.name || packed?.version !== manifest.version) {
    failures.push('Packed package name or version differs from package.json')
  }
  const packageRoots = new Set(['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE'])
  const runtimeScripts = new Set(['cli.mjs', 'doctor.mjs', 'scaffold.mjs', 'self-test.mjs'])
  const packagedFiles = new Set((packed?.files ?? []).map(file => file.path))
  for (const name of packagedFiles) {
    const allowed = packageRoots.has(name)
      || /^dist\/(?:cjs|esm)\/(?:(?:client|errors|index|oauth|response|types|webhooks)\.(?:js|d\.ts)|package\.json)$/.test(name)
      || name.startsWith('scripts/') && runtimeScripts.has(name.slice('scripts/'.length))
      || name.startsWith('examples/checkout-service/') && examples.has(name.slice('examples/checkout-service/'.length))
    if (!allowed) failures.push(`Unexpected packaged file: ${name}`)
  }
  for (const name of [
    ...packageRoots, 'dist/cjs/index.js', 'dist/cjs/index.d.ts',
    'dist/esm/index.js', 'dist/esm/index.d.ts', 'dist/esm/package.json',
    ...[...runtimeScripts].map(name => 'scripts/' + name),
    ...[...examples].filter(name => name !== 'portone.md').map(name => 'examples/checkout-service/' + name),
  ]) {
    if (!packagedFiles.has(name)) failures.push(`Required package file is missing: ${name}`)
  }
}

if (failures.length) {
  // Print locations and categories, never matching secret values.
  for (const failure of failures) console.error(failure)
  process.exitCode = 1
} else {
  console.log(`Public repository checks passed (${manifest.name}@${manifest.version}, ${files.size} files${packIndex === -1 ? '' : ', package contents checked'}).`)
}
