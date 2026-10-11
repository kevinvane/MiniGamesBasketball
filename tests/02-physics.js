'use strict';
/* 02 · simulateShot 等价性回归
   —— 这份函数被重构过四次（hoopAt / circleRect / 矩形清单 / fast 提前收工），
   任何一处都可能**静默改掉弹道**：不报错、不崩溃，只是球的路线悄悄变了。
   所以拿一份「重构前的原版」（lib/baseline-sim.js）逐点比对。

   为什么每一步都要断言：
     · 对照组有效性 —— 先证明原版真的会判进球，再去比新旧
     · 样本刻意贴着判定边界取 —— 均匀随机撒 1000 条里只有 4% 会进球，
       而两条实现真正会分岔的地方恰恰是「擦着篮圈边缘」的那几条 */

const B = require('./boot');
const OLD = require('./lib/baseline-sim');
const { boot, freshStore, frames, click, clickSeg, head, ok, done } = B;

head('A. 对照组有效性：原版确实会判进球');
const h = boot(freshStore());
clickSeg(h, 'mode', 1);
click(h, 'btnStart');
frames(h, 3);
const G = h.win.__G;
const sim = h.win.__simulateShot;
/* 基准必须拿到和游戏一样的 RELEASE_DELAY，否则比的是两套时间基准、不是「重构有没有改物理」。
   P2-7 把这个常量从 32.2 帧修成了 33 帧，这里跟着走 —— 见 baseline-sim.js 顶部注释。 */
const REL = h.win.__RELEASE_DELAY;
{
  const apex = OLD.jumpApex(1/60);
  const o = OLD.releaseOrigin(0.75, apex);
  let made = 0;
  for (let sp = 400; sp <= 1500; sp += 20)
    if (OLD.simulateShot(o.x, o.y, Math.cos(.75)*sp, -Math.sin(.75)*sp, {...h.win.__drawLevel(31337,0), timer:0}, REL).scored) made++;
  ok(made > 0, '原版在第 1 关扫出了 ' + made + ' 杆进球 —— 对照组有效');
}

head('B. 新旧 simulateShot 逐条弹道比对（含移动篮架 / 风 / 挡板）');
{
  const savedLv = G.lv, savedOff = G.hoopOff;
  let n = 0, diffPts = 0, diffScore = 0, diffArrive = 0, fp = 0, conservative = 0, makes = 0, nearMiss = 0;
  const examples = [];

  const samples = [];
  for (let i = 0; i < 1000; i++) samples.push({ seed:i, mode:'rnd' });
  for (let L = 0; L < 60; L++){
    const lv = h.win.__drawLevel(777 + L*101, L);
    for (const phase of [0, 0.31, 0.62]){
      const lvT = { ...lv, timer: phase };
      G.lv = lvT; G.hoopOff = 0;
      let best = null;
      for (let a = 0.05; a < 1.45 && !best; a += 0.01){
        const o = h.win.__releaseOrigin(a);
        for (let sp = 380; sp <= 1520; sp += 16){
          const s = sim(o.x, o.y, Math.cos(a)*sp, -Math.sin(a)*sp, {pts:false, fast:true});
          if (s.scored && (!best || s.arrive.err < best.err)){ best = { a, sp, lvT }; break; }
        }
      }
      if (!best) continue;
      for (let k = 0; k < 8; k++){
        samples.push({
          mode:'near', lvT: best.lvT,
          ang: Math.max(.03, best.a + ((k%4)-1.5)*0.02),
          sp : Math.max(360, Math.min(1520, best.sp + (Math.floor(k/4)*2-1)*9))
        });
      }
    }
  }

  for (const smp of samples){
    let lv, ang, sp;
    if (smp.mode === 'rnd'){
      lv = { ...h.win.__drawLevel(1000 + smp.seed * 31, smp.seed % 50), timer:(smp.seed % 7) * 0.37 };
      ang = 0.03 + (smp.seed * 0.0137) % 1.42;
      sp  = 360 + (smp.seed * 97.3) % 1160;
    } else { lv = smp.lvT; ang = smp.ang; sp = smp.sp; }
    G.lv = lv; G.hoopOff = 0;
    const oo = h.win.__releaseOrigin(ang);
    const vx = Math.cos(ang) * sp, vy = -Math.sin(ang) * sp;
    const a = OLD.simulateShot(oo.x, oo.y, vx, vy, lv, REL);
    const bFull = sim(oo.x, oo.y, vx, vy);                              // 默认（预览用）
    const bFast = sim(oo.x, oo.y, vx, vy, {pts:false, fast:true});      // 求解器用
    n++;
    if (a.scored) makes++;
    if (!a.scored && a.arrive && a.arrive.err <= lv.rim) nearMiss++;

    let bad = a.pts.length !== bFull.pts.length;
    if (!bad) for (let k = 0; k < a.pts.length; k++){
      const p = a.pts[k], q = bFull.pts[k];
      if (p.x !== q.x || p.y !== q.y || !!p.m !== !!q.m){ bad = true; examples.push(`路径点 #${k}`); break; }
    }
    if (bad) diffPts++;
    if (a.scored !== bFull.scored || a.rimHit !== bFull.rimHit || a.boardHit !== bFull.boardHit) diffScore++;
    const aa = a.arrive, ab = bFull.arrive;
    if (!!aa !== !!ab || (aa && ab && (aa.err !== ab.err || aa.t !== ab.t || aa.x !== ab.x))){
      diffArrive++; examples.push('命中时刻');
    }
    if (bFast.scored && !a.scored) fp++;                 // 假阳性：必须为 0
    if (a.scored && !bFast.scored) conservative++;        // 保守漏判：允许
  }
  G.lv = savedLv; G.hoopOff = savedOff;

  console.log(`  比对 ${n} 条：进球 ${makes} 条、擦筐未进 ${nearMiss} 条（合计 ${((makes+nearMiss)/n*100).toFixed(1)}% 落在判定边界附近）`);
  console.log(`  fast 提前收工：假阳性 ${fp} 条（必须为 0）、保守漏判 ${conservative} 条（漏掉「从篮下弹回穿筐」的擦板进球）`);
  ok(n >= 1400, '跑满了 ' + n + ' 条样本');
  ok(makes > 150, '进球样本足够多（' + makes + ' 条），比对才有意义');
  ok(makes + nearMiss >= 250, '判定边界附近样本共 ' + (makes+nearMiss) + ' 条（进球 ' + makes + ' + 擦筐 ' + nearMiss + '）');
  ok(diffPts === 0, '路径点逐点完全一致（浮点级），差异 ' + diffPts + ' 条');
  ok(diffScore === 0, 'scored / rimHit / boardHit 完全一致，差异 ' + diffScore + ' 条');
  ok(diffArrive === 0, '命中时刻与误差完全一致，差异 ' + diffArrive + ' 条');
  /* fast 只在「球已掉到篮圈下方 40px 且仍在下落」时收工，于是会漏掉
     「掉到篮下 → 弹地 / 弹板 → 再倒着穿上去」的擦板进球（实机算分、求解器不算）。
     两个方向必须分开看：
       · 假阳性 fast说进但原版说不进 —— 0 条。这条是硬要求：一旦出现，
         求解器就会把「其实进不去」的关当成可解关放出去。
       · 保守漏判 —— 允许，方向是安全的（更严）。                              */
  ok(fp === 0, 'fast 提前收工**没有**假阳性（fast 说进的，原版一定也算进），' + fp + ' 条');
  if (examples.length) console.log('  例：' + examples.slice(0, 5).join(' | '));
}

head('C. 求解器 ↔ 实机闭环：求解器说能进，实机那一杆是否真进');
{
  /* 本项目最核心的不变量。B 节证明 simulateShot 自身没被改坏，
     但没证明「simulateShot 判进 = 实机也进」。这里把两者接起来：
     拿求解器给的参数，驱动**真实指针事件**打出去，看分加没加。

     历史：修 P2-7 之前是「静止 4/4、x 轴移动 2/2、y 轴移动 **0/2 全灭**」——
     RELEASE_DELAY 比实机实际出手时刻少 0.8 帧，篮架每帧最多移 1.6px，
     y 轴篮架在「球顶点 ≈ 篮圈高度」时 1.3px 就足以让「穿过篮圈平面」翻转。
     修成 33 帧之后三类全部 100%。                                        */
  const stat = { static:{n:0, ok:0}, moverX:{n:0, ok:0}, moverY:{n:0, ok:0} };
  const fails = [];
  for (let li = 0; li < h.win.__LEVELS.length; li++){
    const h2 = boot(freshStore());
    click(h2, 'btnStart');
    const G2 = h2.win.__G;
    h2.win.__loadLevel(li);
    frames(h2, 2);
    const shot = B.solveBest(h2);
    if (!shot) continue;
    const before = G2.makes;
    B.drag(h2, shot);
    for (let f = 0; f < 700 && G2.phase !== 'aim' && G2.phase !== 'over'; f++) frames(h2, 1);
    const axis = G2.lv.mover ? G2.lv.mover.axis : 'static';
    const bucket = stat[axis === 'x' ? 'moverX' : axis === 'y' ? 'moverY' : 'static'];
    bucket.n++;
    if (G2.makes > before) bucket.ok++;
    else fails.push(`第${li+1}关(${axis}) 模型误差 ${shot.err.toFixed(2)}px → 实机没进`);
  }
  console.log('  静止篮架 ' + stat.static.ok + '/' + stat.static.n +
              ' · x 轴移动 ' + stat.moverX.ok + '/' + stat.moverX.n +
              ' · y 轴移动 ' + stat.moverY.ok + '/' + stat.moverY.n);
  fails.forEach(s => console.log('    ' + s));
  const total = stat.static.n + stat.moverX.n + stat.moverY.n;
  ok(total === 8, '8 个关卡都参与了闭环测试');
  ok(stat.static.ok === stat.static.n, '静止篮架关：求解器判进 → 实机必进（' + stat.static.ok + '/' + stat.static.n + '）');
  ok(stat.moverX.ok === stat.moverX.n, 'x 轴移动篮架关：实机必进（' + stat.moverX.ok + '/' + stat.moverX.n + '）');
  ok(stat.moverY.ok === stat.moverY.n, 'y 轴移动篮架关：实机必进（P2-7 修好后应全中）' + stat.moverY.ok + '/' + stat.moverY.n + '）');
}

head('D. P2-7 回归护栏：RELEASE_DELAY 必须等于实机实际出手时刻');
{
  /* 状态机按整帧推进：下蹲要 ceil(CROUCH_T*60) = 11 帧，起跳到顶点 22 帧，
     实机出手 = 33 帧 = 0.55s。模拟器假定的时间基准必须与之一致，
     否则移动篮架上的预览会系统性偏 1.3px。
     注意：这里数**帧数**而不是 g.lv.timer 的差值 ——
     updateLevelMotion() 在没有移动篮架的关卡里直接 return，
     g.lv.timer 对静止关恒为 0，拿它算时间差会得到「0 帧」的错误结论。 */
  const h2 = boot(freshStore());
  click(h2, 'btnStart'); frames(h2, 3);
  const G2 = h2.win.__G;
  h2.win.__loadLevel(2);          // 第 3 关，y 轴移动篮架（timer 才会走）
  frames(h2, 4);
  B.drag(h2, { a: 0.7, sp: 900 });
  let actualFrames = -1;
  for (let f = 0; f < 120; f++){
    const before = G2.phase;
    frames(h2, 1);
    if (before !== 'fly' && G2.phase === 'fly'){ actualFrames = f + 1; break; }
  }
  ok(actualFrames > 0, '成功捕获到出手时刻（对照组有效）');
  const constFrames = h2.win.__RELEASE_DELAY * 60;
  console.log('  实机出手 = ' + actualFrames + ' 帧；RELEASE_DELAY = ' +
              h2.win.__RELEASE_DELAY.toFixed(4) + 's = ' + constFrames.toFixed(2) + ' 帧');
  ok(actualFrames === 33, '实机出手确实是 33 帧（11 帧下蹲 + 22 帧起跳），实际 ' + actualFrames);
  ok(Math.abs(constFrames - actualFrames) < 0.05,
     'RELEASE_DELAY 与实机一致（差 ' + (constFrames - actualFrames).toFixed(2) + ' 帧）—— ' +
     'P2-7 之前这里是 -0.8 帧，会导致 y 轴移动篮架关预览翻面');
}

head('E. P2-7 的影响量化：同一套物理、两套时间基准，差多少');
{
  /* 给这次修正留一个可复核的量化记录，而不是只写「修好了」。
     做法：对同一批样本，用 baseline-sim 分别按修正前(32.2 帧)与修正后(33 帧)跑，
     看移动篮架关的命中判定差多少 —— 这正是当初把 y 轴关判死的那个量。 */
  const savedLv = G.lv, savedOff = G.hoopOff;
  let n = 0, diffStatic = 0, diffMover = 0;
  for (let i = 0; i < 600; i++){
    const lv = h.win.__drawLevel(4000 + i * 17, i % 45);
    lv.timer = (i % 5) * 0.29;
    G.lv = lv; G.hoopOff = 0;
    const o = h.win.__releaseOrigin(0.55 + (i % 9) * 0.05);
    const sp = 600 + (i % 40) * 22;
    const vx = Math.cos(0.55 + (i % 9) * 0.05) * sp, vy = -Math.sin(0.55 + (i % 9) * 0.05) * sp;
    const before = OLD.simulateShot(o.x, o.y, vx, vy, lv, OLD.ORIGINAL_REL);
    const after  = OLD.simulateShot(o.x, o.y, vx, vy, lv, OLD.FIXED_REL);
    n++;
    if (before.scored !== after.scored){
      if (lv.mover) diffMover++; else diffStatic++;
    }
  }
  G.lv = savedLv; G.hoopOff = savedOff;
  console.log('  600 条样本里，判定因这次修正而改变的：移动篮架 ' + diffMover + ' 条、静止篮架 ' + diffStatic + ' 条');
  ok(diffStatic === 0, '静止篮架关完全不受影响（篮架不动，时间基准无所谓），差异 ' + diffStatic + ' 条');
  ok(diffMover > 0, '移动篮架关确实被影响（差异 ' + diffMover + ' 条），说明这次修正不是空改');
  ok(diffMover / n < 0.15, '影响面可控（< 15% 的样本），实际 ' + (diffMover / n * 100).toFixed(1) + '%');
}

done();
