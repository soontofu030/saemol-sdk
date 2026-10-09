#!/usr/bin/env node
const command = process.argv[2]
if (command === 'scaffold') await import('./scaffold.mjs')
else if (command === 'doctor') await import('./doctor.mjs')
else if (command === 'self-test') await import('./self-test.mjs')
else { console.error('saemol-sdk scaffold --framework next|express --out <새 폴더> [--write]\nsaemol-sdk doctor\nsaemol-sdk self-test'); process.exitCode = 1 }
