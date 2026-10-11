'use strict';
/* 04 · 战役 8 关的求解器回归
   —— 无尽 / 每日只是「多了一种关卡来源」，绝不能动到手工配的这 8 关。

   关卡求解器是给**生成关**用的，口径刻意偏严（命中误差 rim/2-7、角度窗口 ±0.55rad），
   好让随机生成的关不至于「只在极窄窗口能进」。拿它去审判手工关卡会误判：
   L3 / L7 在篮架走到最低点的那几个相位确实扫不到解，但放宽到游戏真正的判定阈值
   （rim/2-4）+ 全角扫描，12 个相位全都进得去 —— 也就是说战役的
   「所有相位都有解」是成立的，只是解落在更刁钻的角度上。
   所以这里单独写一份宽松求解器来验战役，**不放进游戏代码里**。 */

const B = require('./boot');
const { boot, freshStore, frames, click, head, ok, done } = B;

const h = boot(freshStore());
click(h, 'btnStart'); frames(h, 3);
const G = h.win.__G, LEVELS = h.win.__LEVELS;
const APEX = (() => {
  const step = 1500/60, jv = Math.sqrt(2*1500*96), n = Math.ceil(jv/step);
  let y = 0, vy = -jv;
  for (let i = 0; i < n; i++){ vy += step; y += vy/60; }
  return y;
})();

function looseSolve(lv, timer, span){
  const A = 41, P = 57, sp0 = 340;
  const o0 = { x: 202 + 36, y: 542 + APEX - 46 - 38 };
  const a0 = Math.atan2(o0.y - lv.hoopY, lv.hoopX - o0.x);
  let found = 0;
  for (let ai = 0; ai < A; ai++){
    const ang = a0 - span + 2*span*ai/(A-1);
    if (ang < .02 || ang > 1.5) continue;
    const o = { x: 202 + Math.cos(-ang)*36, y: 542 + APEX - 46 - 38 + Math.sin(-ang)*36 };
    for (let pi = 0; pi < P; pi++){
      const sp = sp0 + (1520-sp0)*pi/(P-1);
      let vx = Math.cos(ang)*sp, vy = -Math.sin(ang)*sp;
      if (vy > -140){ const k = sp/Math.max(Math.hypot(vx,vy),1); vx *= k; vy *= k; }
      G.lv = { ...lv, timer }; G.hoopOff = 0;
      const s = h.win.__simulateShot(o.x, o.y, vx, vy, {pts:false, fast:false});
      if (s.scored && s.arrive && s.arrive.err <= lv.rim/2 - 4) found++;
    }
  }
  return found;
}

head('1. 8 关全部可解（以游戏真正的判定阈值 rim/2-4 计）');
for (let i = 0; i < LEVELS.length; i++)
  ok(looseSolve(LEVELS[i], 0, 1.3) >= 1, `第 ${i+1} 关有解（${LEVELS[i].tip}）`);

head('2. 移动篮架关：遍历整个周期，所有相位都要能打进');
for (let i = 0; i < LEVELS.length; i++){
  const m = LEVELS[i].mover;
  if (!m) continue;
  const period = 2*Math.PI/m.speed, N = 12;
  let okPhases = 0;
  for (let p = 0; p < N; p++) if (looseSolve(LEVELS[i], p/N*period, 1.3) >= 1) okPhases++;
  console.log(`  第 ${i+1} 关（${m.axis} 轴振幅 ${m.amp}）：${N} 个相位里 ${okPhases} 个可解`);
  ok(okPhases === N, `第 ${i+1} 关在全部 ${N} 个相位下都有解（${okPhases}/${N}）`);
}

head('3. 战役关卡数据未被生成器改动');
{
  const expect = [
    { hoopX:645, hoopY:262, rim:60, time:30, par:520,  wind:0   },
    { hoopX:795, hoopY:236, rim:60, time:30, par:560,  wind:0   },
    { hoopX:705, hoopY:244, rim:58, time:28, par:600,  wind:0   },
    { hoopX:858, hoopY:278, rim:54, time:28, par:640,  wind:110 },
    { hoopX:672, hoopY:212, rim:56, time:26, par:680,  wind:-110},
    { hoopX:824, hoopY:234, rim:54, time:26, par:720,  wind:0   },
    { hoopX:748, hoopY:192, rim:54, time:24, par:760,  wind:130 },
    { hoopX:862, hoopY:210, rim:54, time:24, par:800,  wind:-100}
  ];
  let same = true;
  for (let i = 0; i < expect.length; i++){
    const L = LEVELS[i];
    for (const k in expect[i]){
      if (L[k] !== expect[i][k]){ same = false; console.log('  !! 第'+(i+1)+'关 '+k+' 变成 '+L[k]+'，期望 '+expect[i][k]); }
    }
  }
  ok(same, '8 关的关键参数与路线图记录逐条一致');
  ok(h.win.__levelAt(0).hoopX === 645, '战役第 1 关直接查表，未经生成器');
  ok(h.win.__levelAt(7).tip === LEVELS[7].tip, '战役第 8 关的提示文案也未被改写');
}

head('4. 难度曲线');
{
  const pars = LEVELS.map(l => l.par);
  let rising = true;
  for (let i = 1; i < pars.length; i++) if (pars[i] <= pars[i-1]) rising = false;
  ok(rising, '8 关目标分单调递增：' + pars.join(' → '));
  /* 篮宽不是严格单调：第 5 关从 54 回到 56。那是篮更高导致的补偿，不是数据错乱。 */
  const rims = LEVELS.map(l => l.rim);
  ok(rims[0] === 60 && rims[7] === 54, '篮宽从 60 收到 54：' + rims.join(' → '));
  ok(rims.every(r => r >= 54 && r <= 60), '所有篮宽都在 [54, 60] 内（L8 的 54 已是最窄）');
  ok(LEVELS.filter(l => l.mover).length === 4, '恰好 4 关有移动篮架（L3/L6/L7/L8）');
  ok(LEVELS.filter(l => l.wind).length === 4, '恰好 4 关有风（L4/L5/L7/L8）');
  ok(LEVELS.filter(l => l.blocks.length).length === 3, '恰好 3 关有挡板（L5/L7/L8）');
  ok(LEVELS.reduce((n,l)=>n+l.blocks.length,0) === 4, '挡板总数 4 块（L8 占 2 块）');
}

done();
