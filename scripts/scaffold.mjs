import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const args = process.argv.slice(2)
const option = key => args[args.indexOf(key) + 1]
const framework = args.includes('--framework') ? option('--framework') : 'express'
const target = path.resolve(args.includes('--out') ? option('--out') : './saemol-connection')
if (!['express', 'next'].includes(framework)) throw new Error('--framework next 또는 express를 선택하세요.')
if (target === path.parse(target).root || target === path.resolve(root)) throw new Error('새 연결 폴더를 지정하세요.')
const files = new Map()
for (const name of ['handlers.mjs', 'store.mjs', 'adapters.mjs']) {
  files.set('lib/saemol/' + name, (await readFile(path.join(root, 'examples/checkout-service', name), 'utf8')).replaceAll("'../../dist/esm/index.js'", "'@saemol/sdk'"))
}
files.set('lib/saemol/auth.mjs', `// 실제 서비스의 서버 세션에서 사용자 ID를 반환하세요. 요청 본문의 ID는 신뢰하지 않습니다.
// 로그인 검증을 구현하기 전에는 모든 구매 요청을 거부합니다.
export async function resolveUserId(_request) { return null }
`)
files.set('lib/saemol/routes.mjs', `import { Saemol } from '@saemol/sdk'
import { PurchaseStore } from './store.mjs'
import { createHandlers } from './handlers.mjs'
import { resolveUserId } from './auth.mjs'
let handlers
export function getHandlers() {
  if (!handlers) {
    const { SAEMOL_SECRET, SAEMOL_WEBHOOK_SECRET, SAEMOL_ITEM_CODES, PURCHASE_DB_PATH } = process.env
    if (!SAEMOL_SECRET || !SAEMOL_WEBHOOK_SECRET || !SAEMOL_ITEM_CODES || !PURCHASE_DB_PATH) throw new Error('서버 환경 변수를 설정하세요.')
    handlers = createHandlers({ saemol: new Saemol({ secret: SAEMOL_SECRET }), store: new PurchaseStore(PURCHASE_DB_PATH), webhookSecret: SAEMOL_WEBHOOK_SECRET, resolveUserId, allowedItemCodes: SAEMOL_ITEM_CODES.split(',').map(x => x.trim()).filter(Boolean) })
  }
  return handlers
}
`)
if (framework === 'next') {
  for (const [name, method, handler] of [['checkout', 'POST', 'checkout'], ['webhook', 'POST', 'webhook'], ['portal', 'GET', 'portal']]) {
    files.set(`app/api/saemol/${name}/route.js`, `import { getHandlers } from '../../../../lib/saemol/routes.mjs'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function ${method}(request) { return getHandlers().${handler}(request) }
`)
  }
} else {
  files.set('server.mjs', `import express from 'express'
import { getHandlers } from './lib/saemol/routes.mjs'
import { mountExpressRoutes } from './lib/saemol/adapters.mjs'
const app = express()
mountExpressRoutes(app, express, getHandlers()) // 웹훅 raw body 처리를 express.json()보다 먼저 등록
app.use(express.json())
app.listen(Number(process.env.PORT ?? 4300), '127.0.0.1')
`)
}
files.set('.env.example', `# 서버 전용. 실제 키를 저장소에 올리지 마세요.
SAEMOL_SECRET=
SAEMOL_WEBHOOK_SECRET=
SAEMOL_ITEM_CODES=
PURCHASE_DB_PATH=./purchases.sqlite
PORT=4300
`)
files.set('.gitignore', '.env\n.env.local\n*.sqlite*\nnode_modules/\n')
files.set('README.md', `# 새몰 ${framework === 'next' ? 'Next.js' : 'Express'} 연결 시작

1. Node.js 24 이상과 영구 저장 경로를 준비합니다. 기존 프로젝트에 필요한 파일을 검토해 복사하세요.
2. @saemol/sdk 0.5.0 이상을 설치합니다.${framework === 'express' ? ' express도 설치합니다.' : ' Next.js App Router 프로젝트에 붙입니다.'}
3. .env.example을 서버 환경 변수로 설정합니다. 기본 키 또는 필요한 권한을 모두 가진 추가 키를 사용하세요.
4. lib/saemol/auth.mjs의 resolveUserId를 실제 서버 로그인 세션으로 구현합니다. 기본 상태는 구매 요청을 거부합니다.
5. 웹훅 주소를 상품 수정 → 연동 정보에서 등록합니다. 테스트 키 검증은 PG 테스트 결제와 다릅니다.
6. 0원 아이템으로 주문 → 서버 DB 적용 → 적용 확인을 검사합니다. 결제 복귀 URL만으로 지급하지 않습니다.

checkout.write, checkout.read, checkout.ack, portal.read 권한이 필요합니다. 별도 문서/API 호스팅이나 AI 호출은 사용하지 않습니다.

이 예제의 SQLite는 단일 영구 Node 프로세스용입니다. 다중 인스턴스·서버리스 배포에서는 공유 DB 트랜잭션과 고유 제약으로 PurchaseStore를 바꾸고 장애 복구를 검증하세요. PG 실결제·환불·정산 검증은 계약 후 별도로 수행합니다.
`)

// Check the entire plan before writing anything. Refuse symlink traversal and all
// existing targets; the tool never reads real env files or contacts a service.
for (const name of files.keys()) {
  const dest = path.resolve(target, name)
  if (!dest.startsWith(target + path.sep)) throw new Error('잘못된 출력 경로입니다.')
  let current = dest
  while (true) {
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink()) throw new Error('심볼릭 링크 경로에는 생성하지 않습니다.')
      if (current === dest) throw new Error('기존 파일을 덮어쓰지 않습니다: ' + name)
      if (!stat.isDirectory()) throw new Error('출력 경로의 상위 항목이 폴더가 아닙니다.')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
}
console.log(JSON.stringify({ mode: args.includes('--write') ? 'write' : 'preview', framework, target, files: [...files.keys()], containsSecrets: false, callsExternalServices: false }, null, 2))
if (args.includes('--write')) {
  for (const [name, text] of files) {
    const dest = path.join(target, name)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, text, { flag: 'wx' })
  }
}
