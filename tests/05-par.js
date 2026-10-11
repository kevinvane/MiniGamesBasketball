'use strict';
/* 05 · par 够不够得着
   ——「生成器算出来的目标分」这件事必须用**真打过一遍**来验，光看公式推不出结论。
   机器人每球挑最优解、不浪费球，水平大致相当于「会读辅助线的新手」，
   真实玩家应当不差于它；它打不动的地方大概率也没法打。

   刻意只跑一局并设硬上限：本文件只用来证伪「par 定得太离谱」，不是精确测量。 */

const B = require('./boot');
const { boot, freshStore, frames, click, clickSeg, playBall, head, ok, done } = B;

head('1. 机器人实打：逐波记录用球数与是否达标');
const h = boot(freshStore());
clickSeg(h, 'mode', 1);
click(h, 'btnStart'); frames(h, 3);
const G = h.win.__G;
const waves = [];
let cleared = 0, guard = 0;
/* 硬上限有两条，缺一不可：
     · 波次上限 —— 机器人越强打得越远，没有上限这文件能跑到天荒地老
     · 墙钟预算 —— 波次上限之内也可能变慢（每球要扫 1500 条弹道） */
const MAX_WAVES = 40, TIME_BUDGET_MS = 60000;
const started = Date.now();
while (G.phase !== 'over' && guard < MAX_WAVES && Date.now() - started < TIME_BUDGET_MS){
  if (G.phase !== 'aim'){ frames(h, 1); continue; }
  const li = G.levelIndex, c0 = G.cleared, s0 = G.attempts;
  /* 内层必须按**迭代次数**收敛，不能只看 attempts：
     solveBest 找不到解时不会出手（attempts 不变），若只盯着 attempts 就会死循环 ——
     这是本文件第一次跑挂掉的原因。内层循环一定要有一个与「有没有出手」无关的计数器。 */
  let tries = 0;
  while (G.phase === 'aim' && G.levelIndex === li && tries++ < 14){
    if (G.levelPts >= G.lv.par) break;
    if (G.attempts - s0 >= 12) break;
    playBall(h);
  }
  if (G.levelIndex === li) break;                   // 本关没推进（大概率是心用光结束）
  if (G.cleared > c0) cleared++;
  waves.push({ wave: li+1, ok: G.cleared > c0, shots: G.attempts - s0 });
}
const hitCap = guard >= MAX_WAVES || Date.now() - started >= TIME_BUDGET_MS;
if (hitCap) console.log('  （触到硬上限就收工，本文件只用来证伪「par 定得太离谱」，不是精确测量）');
const good = waves.filter(w => w.ok), bad = waves.filter(w => !w.ok);
const avgShots = good.reduce((s,w)=>s+w.shots,0) / Math.max(1,good.length);
console.log(`  打到第 ${G.levelIndex+1} 波：${waves.length} 波里达标 ${good.length}、超时 ${bad.length}`);
console.log(`  达标平均 ${avgShots.toFixed(1)} 球；机器人命中率 ${Math.round(G.makes/G.attempts*100)}%`);
ok(G.makes >= 8 && cleared >= 2, '对照组有效：机器人打进 ' + G.makes + ' 球、达标 ' + cleared + ' 波');
ok(good.length >= 4, '达标样本够用（' + good.length + ' 波）');
ok(avgShots >= 2 && avgShots <= 6, '达标平均用球在 2~6 之间（< 2 说明 par 虚低，> 6 说明打不动），实际 ' + avgShots.toFixed(1));
ok(bad.length / Math.max(1,waves.length) < 0.30, '超时占比 < 30%（par 不能定到打不动），实际 ' + Math.round(bad.length/Math.max(1,waves.length)*100) + '%');

head('2. par 的量级（纯生成，不打球，很便宜）');
{
  const pars = [], times = [];
  for (let i = 0; i < 40; i++){ const lv = h.win.__levelAt(i); pars.push(lv.par); times.push(lv.time); }
  const mn = Math.min(...pars), mx = Math.max(...pars);
  console.log(`  par 区间 ${mn}~${mx}；前 8 波 ${pars.slice(0,8).join(',')}；后 8 波 ${pars.slice(32).join(',')}`);
  ok(mn >= 400 && mx <= 1200, 'par 落在 400~1200（2~4 球量级），实际 ' + mn + '~' + mx);
  const grow = pars.slice(32).reduce((a,b)=>a+b,0)/8 - pars.slice(0,8).reduce((a,b)=>a+b,0)/8;
  ok(grow > 0, 'par 随波次上升，实际增量 ' + grow.toFixed(0));
  ok(Math.max(...times) <= 30 && Math.min(...times) >= 20, '限时始终在 20~30s 之间');
}

done();
