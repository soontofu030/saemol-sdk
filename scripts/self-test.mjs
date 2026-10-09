import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('로컬 SQLite 셀프 테스트는 Node.js 24 이상이 필요합니다.')
// Entirely local: synthetic checkout data, temporary SQLite, signed events and
// injected API responses. No PG/payment, customer record or remote service call.
console.log('로컬 셀프 테스트: 중복 이벤트·응답 유실·환불 순서·재시작 복구. PG 실결제는 검사하지 않습니다.')
const processHandle = spawn(process.execPath, ['--test', fileURLToPath(new URL('../examples/checkout-service/store.verify.mjs', import.meta.url))], { stdio: 'inherit', windowsHide: true })
processHandle.on('error', () => { process.exitCode = 1 })
processHandle.on('exit', code => { process.exitCode = code ?? 1 })
