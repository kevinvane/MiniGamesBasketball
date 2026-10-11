'use strict';
/* 一次跑完全部回归：node tests/run-all.js
   可选参数：
     node tests/run-all.js 03          只跑文件名含 "03" 的套件
     node tests/run-all.js --html x.html  换一份 index.html 来测（比如改动前的备份）

   退出码：0 全过 / 1 有失败。CI 或提交前跑一下就知道有没有把玩法改坏。 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const here = __dirname;
const argv = process.argv.slice(2);
let filter = '';
let html = '';
for (let i = 0; i < argv.length; i++){
  if (argv[i] === '--html') html = argv[++i];
  else filter = argv[i];
}

const SUITES = fs.readdirSync(here)
  .filter(f => /^\d\d-.*\.js$/.test(f))        // 只认 NN-xxx.js，避免把 boot / run-all 自己也跑进去
  .sort();
const picked = filter ? SUITES.filter(f => f.includes(filter)) : SUITES;

if (!picked.length){
  console.error('没有匹配到任何套件：' + filter);
  process.exit(2);
}

console.log('被测文件: ' + (html || path.join(here, '..', 'index.html')));
console.log('共 ' + picked.length + ' 个套件' + (filter ? '（过滤：' + filter + '）' : ''));

let totalPass = 0, totalFail = 0, crashed = 0;
const t0 = Date.now();

for (const f of picked){
  const suite = path.join(here, f);
  const label = f.replace(/\.js$/, '');
  const s = Date.now();
  let out = '';
  try {
    out = execFileSync(process.execPath, [suite], {
      encoding: 'utf8', maxBuffer: 1 << 26,
      env: html ? Object.assign({}, process.env, {NULAN_HTML: html}) : process.env
    });
  } catch (e){
    // 退出码非 0：仍然把它的输出打出来（可能是断言失败，也可能是中途崩了）
    out = (e.stdout || '') + (e.stderr || '');
  }
  const secs = ((Date.now() - s) / 1000).toFixed(1);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m){ totalPass += +m[1]; totalFail += +m[2]; }
  else { crashed++; console.log('  !! ' + label + ' 没有输出统计行 —— 可能中途崩了'); }

  process.stdout.write(out.replace(/^/gm, '  ').replace(/^\s+$/gm, ''));
  console.log(`  --- ${label}：${m ? m[1] + ' passed, ' + m[2] + ' failed' : '崩溃'}（${secs}s）\n`);
}

const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log('='.repeat(64));
console.log(`合计：${totalPass} passed, ${totalFail} failed${crashed ? ', ' + crashed + ' 个套件崩溃' : ''}（${total}s）`);
console.log('='.repeat(64));
process.exit(totalFail || crashed ? 1 : 0);
