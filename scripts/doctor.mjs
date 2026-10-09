import { Saemol } from '../dist/esm/index.js'

const environment = process.argv.includes('--live') ? '운영' : '테스트'
const secret = process.argv.includes('--live') ? process.env.SAEMOL_SECRET : process.env.SAEMOL_TEST_SECRET
const checks = [
  { label: `${environment} 연동 키 설정`, ok: !!secret?.trim() },
  { label: '웹훅 서명 키 설정', ok: !!process.env.SAEMOL_WEBHOOK_SECRET?.trim() },
]
const baseUrl = process.env.SAEMOL_BASE_URL || 'https://saemol.com'
try {
  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('invalid_url')
  const health = await new Saemol({ secret: secret || 'diagnostic-no-key', baseUrl, maxRetries: 0, timeoutMs: 6000 }).health()
  checks.push({ label: '새몰 API 접속', ok: health.ok === true })
} catch { checks.push({ label: '새몰 API 접속', ok: false }) }
for (const check of checks) console.log(`${check.ok ? '확인' : '확인 필요'}: ${check.label}`)
console.log('키의 존재와 API 접속을 확인했습니다. 키의 유효성·구매 적용·결제 운영 조건은 연결 화면에서 별도로 확인하세요.')
process.exitCode = checks.every(check => check.ok) ? 0 : 1
