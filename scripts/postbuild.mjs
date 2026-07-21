// 듀얼 빌드(CJS/ESM) 산출물에 모듈 형식 마커를 심는다.
// 패키지 루트는 "type" 미지정(CJS 기본)이므로 dist/esm 쪽에 module 마커가 필수.
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

writeFileSync(join(root, 'dist/cjs/package.json'), JSON.stringify({ type: 'commonjs' }, null, 2) + '\n')
writeFileSync(join(root, 'dist/esm/package.json'), JSON.stringify({ type: 'module' }, null, 2) + '\n')
