'use strict';
/* 01 · 关卡生成器：性能、可解性、确定性、难度曲线
   —— 无尽与每日每过一关都要「现生成一关」，所以这一步的成本直接决定过场卡不卡。 */

const B = require('./boot');
const { boot, freshStore, frames, click, clickSeg, head, ok, done } = B;

head('1. 关卡生成性能（先热身，避免把 JIT 预热算进成本）');
const h = boot(freshStore());
const G = h.win.__G;
clickSeg(h, 'mode', 1);                    // 1 = 无尽
click(h, 'btnStart');
frames(h, 3);
ok(G.mode === 'endless', '切到无尽模式，实际=' + G.mode);

for (let i = 0; i < 30; i++) h.win.__levelAt(i);       // 预热
const times = [], levels = [];
for (let i = 0; i < 80; i++){
  const t0 = process.hrtime.bigint();
  const lv = h.win.__levelAt(i);
  times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  levels.push(lv);
}
const sorted = times.slice().sort((a,b) => a-b);
const med = sorted[Math.floor(sorted.length/2)];
const p95 = sorted[Math.floor(sorted.length*0.95)];
console.log(`  生成 80 关耗时：中位 ${med.toFixed(1)}ms · p95 ${p95.toFixed(1)}ms · 最大 ${sorted[sorted.length-1].toFixed(1)}ms`);
/* 阈值定得宽松是故意的：绝对耗时随机器与当前负载浮动（同一份代码在不同机器上
   p95 实测在 13~19ms 之间飘），阈值卡太紧只会变成随机失败。
   这里要抓的是「回归到重构前那种量级」—— 那是中位 878ms。
   留一个数量级的余量仍然能抓住它，而日常的小幅波动不会误报。
   精确数字看上面那行输出，不看这条断言。 */
ok(med < 15, '单关生成中位耗时 < 15ms（重构前是 878ms），实际 ' + med.toFixed(1) + 'ms');
ok(p95 < 40, '单关生成 p95 < 40ms，实际 ' + p95.toFixed(1) + 'ms');

head('2. 生成关卡的可解性（逐关用 simulateShot 独立复核）');
let bad = 0;
for (let i = 0; i < levels.length; i++){
  if (!h.win.__levelSolvable(levels[i])){
    bad++;
    console.log('  !! 第 ' + i + ' 关不可解：' + JSON.stringify(levels[i]));
  }
}
ok(bad === 0, `${levels.length} 关全部可解（不可解 ${bad} 关）`);

head('3. 首摇可解率（重摇机制到底有没有在干活）');
{
  const savedLv = G.lv, savedOff = G.hoopOff;
  let tried = 0, failed = 0;
  for (let i = 0; i < 400; i++){
    const lv = h.win.__drawLevel(90210 + i * 2654435761 % 100000, i % 60);
    G.lv = lv; G.hoopOff = 0;
    tried++;
    if (!h.win.__levelSolvable(lv)) failed++;
  }
  G.lv = savedLv; G.hoopOff = savedOff;
  const pct = (failed / tried * 100).toFixed(1);
  console.log(`  400 次独立生成中首摇失败 ${failed} 次（${pct}%）→ 这些会走重摇`);
  ok(failed / tried < 0.10,
     '首摇失败率 < 10%（重摇是安全网，不该是主要开销），实际 ' + pct + '%');
}

head('4. 解的密度（避免出现「只在极窄窗口能进」的关）');
{
  const savedLv = G.lv, savedOff = G.hoopOff;
  let thin = 0, minSol = 999;
  for (const lv of levels.slice(0, 40)){
    G.lv = lv; G.hoopOff = 0;
    const n = h.win.__solveOnce(0, 999);       // 999 = 不提前收工，数满
    if (n < minSol) minSol = n;
    if (n < 3){ thin++; console.log('  !! 解偏少：' + n + ' 杆，' + JSON.stringify(lv)); }
  }
  G.lv = savedLv; G.hoopOff = savedOff;
  console.log('  最少的一关有 ' + minSol + ' 杆能进（求解网格共 15 角度 × 26 力度）');
  ok(thin === 0, '40 关里没有「几乎无解」的关（解 < 3 杆的有 ' + thin + ' 关）');
}

head('5. 确定性：同种子同关卡');
{
  const a = h.win.__drawLevel(123456, 7);
  ok(JSON.stringify(a) === JSON.stringify(h.win.__drawLevel(123456, 7)), '同种子同索引 → 完全相同的关卡');
  ok(JSON.stringify(a) !== JSON.stringify(h.win.__drawLevel(123457, 7)), '换种子 → 不同的关卡');
  ok(JSON.stringify(a) !== JSON.stringify(h.win.__drawLevel(123456, 8)), '同种子换索引 → 不同的关卡');
}

head('6. 难度爬升与合法性');
{
  ok(levels[0].rim > levels[50].rim, '篮宽随波次收窄：' + levels[0].rim + ' → ' + levels[50].rim);
  ok(levels[50].rim >= 52, '篮宽没有收窄到物理上不可能进的尺寸，实际 ' + levels[50].rim);
  ok(levels[0].time > levels[50].time, '限时随波次收紧：' + levels[0].time + ' → ' + levels[50].time);
  ok(levels.every(l => l.par > 0), '所有关卡 par 都是正数');
  ok(levels.every(l => l.hoopX >= 400 && l.hoopX + l.rim/2 + 21 <= 960), '篮架 + 篮板完整落在画面内');
  ok(levels.every(l => l.hoopY >= 100 && l.hoopY < 542), '篮架高度合法');
  ok(levels.every(l => l.blocks.every(b => b.x >= 380 && b.x + b.w <= 860 && b.y + b.h === 542)),
     '挡板都站在地面上且不挡住球员');
  ok(levels.every(l => l.blocks.every(b => b.x + b.w < l.hoopX)), '挡板不会顶到篮架上');
  const movers = levels.filter(l => l.mover).length;
  const winds  = levels.filter(l => l.wind).length;
  const blocks = levels.filter(l => l.blocks.length).length;
  console.log('  80 关里：移动篮架 ' + movers + ' · 有风 ' + winds + ' · 有挡板 ' + blocks);
  ok(movers > 5 && winds > 5 && blocks > 5, '三种特殊条件都频繁出现');
}

done();
