'use strict';
/* 03 · 三种模式的规则
   —— 分两层测：
        A. **规则级**：直接调 gainLife / loseLife / finishDaily / advanceLevel，
           把生命、连胜、结束条件当纯函数验。快，且测的是规则本身而不是「打一局碰巧这样」。
        B. **端到端**：只跑必要的完整对局，确认规则接进了真实流程。
      早前这个文件全靠「打完整局」来验，跑了 198 秒还偶发失败 ——
      规则变了要重打一整局才能看出来，很慢也不精确。 */

const B = require('./boot');
const { boot, freshStore, frames, click, clickSeg, isChecked, head, ok, done } = B;

const MODE = { campaign:0, endless:1, daily:2 };

/** 起一局并切到指定模式 */
function run(mode){
  const h = boot(freshStore());
  clickSeg(h, 'mode', mode);
  click(h, 'btnStart');
  frames(h, 3);
  return h;
}

/* ───────────────────────── A. 规则级 ───────────────────────── */

head('A1. 模式选择：两批分段控件共用一份状态');
{
  const h = boot(freshStore());
  ok(h.byAttr['mode'].length === 6,
     '页面上一共 6 个模式按钮（开局卡片 3 个 + 结算卡片 3 个），实际 ' + h.byAttr['mode'].length);
  clickSeg(h, 'mode', MODE.endless);
  ok(isChecked(h, 'mode', 'endless'), '点开局的「无尽」后，它自己变成选中态');
  const checked = h.byAttr['mode'].filter(b => b.getAttribute('aria-checked') === 'true');
  ok(checked.length === 2, '两批按钮各有一个选中（共 2 个），不会出现一处改了一处没改');
  ok(checked.every(b => b.getAttribute('data-mode') === 'endless'), '两个选中态都指向 endless');
  ok(h.win.__SETTINGS.mode === 'endless', '设置对象切到了 endless');
}
{
  const store = freshStore();
  const h = boot(store);
  clickSeg(h, 'mode', MODE.daily);
  ok(store._raw['nulan.settings'].indexOf('"mode":"daily"') >= 0, '模式选择已写入 localStorage');
}
{
  // 非法值不得写进设置
  const h = boot(freshStore());
  clickSeg(h, 'mode', 0);
  h.win.__SETTINGS.mode = '不存在的模式';
  clickSeg(h, 'mode', MODE.endless);
  ok(h.win.__SETTINGS.mode === 'endless', '被外部改成非法值后，再点一次分段控件能纠正回合法值');
}

head('A2. runLength / 关卡标签');
{
  const hc = run(MODE.campaign);
  ok(hc.win.__runLength() === 8, '战役 8 关');
  ok(hc.win.__levelLabel(0) === '1/8', '战役标签 1/8，实际=' + hc.win.__levelLabel(0));
  ok(hc.win.__levelLabel(7) === '8/8', '战役标签 8/8');

  const he = run(MODE.endless);
  ok(he.win.__runLength() === Infinity, '无尽没有关数上限');
  ok(he.win.__levelLabel(0) === '第 1 波', '无尽标签「第 1 波」');
  ok(he.win.__levelLabel(41) === '第 42 波', '无尽标签「第 42 波」');

  const hd = run(MODE.daily);
  ok(hd.win.__runLength() === 3, '每日固定 3 关');
  ok(hd.win.__levelLabel(2) === '3/3', '每日标签 3/3');
  ok(hd.win.__runComplete() === true, '每日走到最后就算成功');
  ok(he.win.__runComplete() === false, '无尽没有「通关」概念');
}

head('A3. 生命：达标回血 / 超时扣命 / 上限封顶');
{
  const h = run(MODE.endless);
  const G = h.win.__G, MAX = h.win.__LIVES_MAX;
  ok(G.lives === MAX, '无尽开局 ' + MAX + ' 颗心，实际=' + G.lives);

  G.lives = 1;  h.win.__gainLife();  ok(G.lives === 2, '1 颗心 → 达标 → 2 颗');
  h.win.__gainLife();                ok(G.lives === 3, '2 颗心 → 达标 → 3 颗');
  h.win.__gainLife();                ok(G.lives === 3, '已满 3 颗时再达标不回超（上限 ' + MAX + '），实际=' + G.lives);

  G.lives = 2;  h.win.__loseLife();  ok(G.lives === 1, '2 颗心 → 超时 → 1 颗');
  h.win.__loseLife();                ok(G.lives === 0, '1 颗心 → 超时 → 0 颗');
}
{
  /* 不变量必须在**写入点**成立，而不是靠下游记得检查。
     早前 loseLife() 是无下界夹取的 g.lives--，一旦 lives 穿过 0 变成 -1，
     updateHUD 里的 '❤'.repeat(g.lives) 就抛 RangeError，把整个 render 循环带崩 ——
     症状是「按了再来一局之后整页报错」，跟真正的原因隔了好几层，极难定位。
     这里直接连续扣到负数区间，要求 stays == 0。 */
  const h = run(MODE.endless);
  const G = h.win.__G;
  G.lives = 1;
  for (let i = 0; i < 8; i++) h.win.__loseLife();
  ok(G.lives === 0, '连扣 8 次也不会跌破 0，实际=' + G.lives);
  frames(h, 3);
  ok(h.els['lifePill'].textContent === '♡♡♡', 'lives=0 时胶囊显示 3 个空心，实际=' + h.els['lifePill'].textContent);
}
{
  /* 渲染层自己也要能扛住越界输入 —— 显示错误不该升级成「游戏卡死」。 */
  const h = run(MODE.endless);
  const G = h.win.__G, MAX = h.win.__LIVES_MAX;
  let threw = null;
  for (const bad of [-1, -99, MAX + 1, 999, NaN]){
    G.lives = bad;
    try { frames(h, 2); } catch (e){ threw = bad + ' → ' + e.message; break; }
  }
  ok(!threw, 'HUD 遇到越界 lives 不抛异常' + (threw ? '：' + threw : ''));
  G.lives = 1; frames(h, 2);
  ok(h.els['lifePill'].textContent === '❤♡♡', '恢复正常值后显示正确，实际=' + h.els['lifePill'].textContent);
}
{
  // 战役不该有命
  const h = run(MODE.campaign);
  h.win.__G.lives = 3;
  h.win.__loseLife();
  ok(h.win.__G.lives === 3, '战役模式下 loseLife() 是空操作（战役没有命），实际=' + h.win.__G.lives);
  frames(h, 2);
  ok(h.els['lifePill'].style.display === 'none', '战役下 HUD 生命胶囊隐藏');
}
{
  const h = run(MODE.endless);
  frames(h, 2);
  ok(h.els['lifePill'].style.display !== 'none', '无尽下 HUD 显示生命胶囊');
  ok(h.els['lifePill'].textContent === '❤❤❤', '生命文案 = 3 颗心，实际=' + h.els['lifePill'].textContent);
  h.win.__G.lives = 1; frames(h, 2);
  ok(h.els['lifePill'].textContent === '❤♡♡', '掉到 1 颗时文案变为 ❤♡♡，实际=' + h.els['lifePill'].textContent);
  ok(h.els['lifePill'].className.indexOf('warn') >= 0, '只剩 1 颗心时胶囊转为告警色');
}

head('A4. 结束条件：达标推进 / 未达标扣命继续 / 心尽即止 / 最后一关结束');
{
  // 战役：未达标也照常进下一关（既有行为，不能变）
  const h = run(MODE.campaign);
  const G = h.win.__G, LV = h.win.__loadLevel;
  LV(0); G.cleared = 0;
  h.win.__advanceLevel(false);                 // 未达标
  ok(G.levelIndex === 1, '战役未达标也会进入下一关（既有行为），实际第 ' + (G.levelIndex+1) + ' 关');
  ok(G.cleared === 0, '未达标不加通关数');
  ok(G.score === 0, '未达标没有时间奖励');
  LV(7); h.win.__advanceLevel(false);
  ok(G.phase === 'over', '战役第 8 关走完即结束，不管达没达标');
}
{
  // 无尽：未达标扣命但继续；心尽则止
  const h = run(MODE.endless);
  const G = h.win.__G, LV = h.win.__loadLevel;
  LV(0); G.lives = 3; G.cleared = 0;
  h.win.__advanceLevel(false);
  ok(G.lives === 2, '无尽未达标扣 1 心，剩 ' + G.lives);
  ok(G.levelIndex === 1, '但仍然进入下一波（难度继续涨），实际第 ' + (G.levelIndex+1) + ' 波');
  ok(G.phase !== 'over', '还有命就不结束');

  G.lives = 1; G.levelIndex = 5;
  h.win.__advanceLevel(false);
  ok(G.lives === 0 && G.phase === 'over', '最后一颗心扣掉即结束，不进下一波');
  ok(h.els['endTitle'].textContent === '♾ 无尽结束', '结算标题为无尽文案：' + h.els['endTitle'].textContent);

  G.lives = 3; G.phase = 'aim';
  h.win.__advanceLevel(true);
  ok(G.lives === 3, '无尽达标时回血，但已经满 3 颗就不再显示变化');
}
{
  // 每日：走完 3 关 = 成功
  const h = run(MODE.daily);
  const G = h.win.__G, LV = h.win.__loadLevel;
  LV(0); h.win.__advanceLevel(true);
  ok(G.levelIndex === 1 && G.phase !== 'over', '过了第 1 关继续第 2 关');
  LV(1); h.win.__advanceLevel(true);
  ok(G.levelIndex === 2 && G.phase !== 'over', '过了第 2 关继续第 3 关');
  LV(2); h.win.__advanceLevel(true);
  ok(G.phase === 'over', '走完第 3 关即结束');
  ok(h.els['endTitle'].textContent.indexOf('今日挑战成功') >= 0, '结算标题为「今日挑战成功」：' + h.els['endTitle'].textContent);
  ok(h.els['endInfo'].innerHTML.indexOf('走完全部 3 关') >= 0, '结算信息写明走完 3 关');
}
{
  // 每日：心尽 = 失败
  const h = run(MODE.daily);
  const G = h.win.__G;
  h.win.__loadLevel(1); G.lives = 1;
  h.win.__advanceLevel(false);
  ok(G.phase === 'over', '每日心尽即结束');
  ok(h.els['endTitle'].textContent.indexOf('今日挑战失败') >= 0, '结算标题为「今日挑战失败」：' + h.els['endTitle'].textContent);
  ok(h.win.__REC.dailyStreak === 0, '挑战失败会把连胜清零');
}

head('A5. 连胜：当天不累加 / 昨天则累加 / 断档归零 / 失败归零');
{
  function dayKey(d){ d = d || new Date(); return d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate(); }
  function shift(k, n){ const y=Math.floor(k/10000), m=Math.floor(k/100)%100, d=k%100;
    const x=new Date(y, m-1, 1); x.setDate(d+n); return dayKey(x); }
  const today = dayKey();

  // 用纯存档 + 直接调 finishDaily 验规则，不打球（秒级）
  function streakCase(rec, win){
    const h = boot(freshStore({ 'nulan.record': JSON.stringify(rec) }));
    clickSeg(h, 'mode', MODE.daily);
    click(h, 'btnStart'); frames(h, 3);
    h.win.__finishDaily(win);
    return h.win.__REC;
  }
  const r1 = streakCase({ dailyStreak:1, dailyDate:today, dailyBest:500 }, true);
  ok(r1.dailyStreak === 1, '当天已完成过 → 再完成不累加，仍是 1 天');

  const r2 = streakCase({ dailyStreak:4, dailyDate:shift(today,-1), dailyBest:500 }, true);
  ok(r2.dailyStreak === 5, '昨天做过 → 今天累加到 5，实际=' + r2.dailyStreak);
  ok(r2.dailyDate === today, 'dailyDate 推进到今天');

  const r3 = streakCase({ dailyStreak:9, dailyDate:shift(today,-3), dailyBest:500 }, true);
  ok(r3.dailyStreak === 1, '断档 3 天后重新完成 → 连胜从 1 重新算，实际=' + r3.dailyStreak);

  const r4 = streakCase({ dailyStreak:9, dailyDate:today, dailyBest:500 }, false);
  ok(r4.dailyStreak === 0, '当天挑战失败 → 连胜立刻清零');

  // curStreak 只认「今天 / 昨天」，更早的按断档处理
  function readStreak(date){
    const h = boot(freshStore({ 'nulan.record': JSON.stringify({ dailyStreak:7, dailyDate:date }) }));
    return h.win.__curStreak();
  }
  ok(readStreak(today) === 7, '今天做过 → 显示 7 天');
  ok(readStreak(shift(today,-1)) === 7, '昨天做过 → 仍显示 7 天（还没过期）');
  ok(readStreak(shift(today,-2)) === 0, '前天做过 → 显示 0（已断档）');
  ok(readStreak(shift(today,-30)) === 0, '一个月前做过 → 显示 0');

  // 跨月 / 跨年的边界
  ok(shift(20260301, -1) === 20260228, '3/1 的前一天 = 2/28（2026 非闰年）');
  ok(shift(20260301, -2) === 20260227, '3/1 的前两天 = 2/27');
  ok(shift(20260301, 1) === 20260302, '2/28 的后一天 = 3/1');
  ok(shift(20260331, 1) === 20260401, '跨月：3/31 + 1 = 4/1');
  ok(shift(20260101, -1) === 20251231, '跨年：1/1 的前一天 = 去年 12/31');
  ok(shift(20261231, 1) === 20270101, '跨年：12/31 + 1 = 明年 1/1');
  ok(shift(20240229, 1) === 20240301, '闰年 2/29 + 1 = 3/1');
}
{
  // 断档时开局面板上的提示要显示 0
  function dayKey(d){ d = d || new Date(); return d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate(); }
  const y = dayKey(); const d0 = new Date(y, Math.floor(y/100)%100-1, 1); d0.setDate(y%100 - 3);
  const store = freshStore({ 'nulan.record': JSON.stringify({ dailyStreak:9, dailyDate:dayKey(d0) }) });
  const h = boot(store);
  clickSeg(h, 'mode', MODE.daily); frames(h, 2);
  ok(h.els['modeHint'].innerHTML.indexOf('连胜 <b>0</b> 天') >= 0,
     '断档时模式提示显示「连胜 0 天」，实际：' + h.els['modeHint'].innerHTML);
  clickSeg(h, 'mode', MODE.endless); frames(h, 2);
  ok(h.els['modeHint'].innerHTML.indexOf('无尽') === -1 && h.els['modeHint'].innerHTML.indexOf('最远') >= 0,
     '无尽模式提示显示最远波次：' + h.els['modeHint'].innerHTML);
}

head('A6. 每日挑战「全球同一份」：同一天两次开局的 3 关完全一致');
{
  function dailyLevels(){
    const h = run(MODE.daily);
    return [h.win.__levelAt(0), h.win.__levelAt(1), h.win.__levelAt(2)];
  }
  const a = dailyLevels(), b = dailyLevels();
  ok(JSON.stringify(a) === JSON.stringify(b), '两次独立开局的 3 关完全相同');
  ok(JSON.stringify(a[0]) !== JSON.stringify(a[1]), '同一天内 3 关彼此不同');
  const e1 = run(MODE.endless), e2 = run(MODE.endless);
  ok(JSON.stringify(e1.win.__levelAt(0)) !== JSON.stringify(e2.win.__levelAt(0)),
     '无尽每次开局换种子 → 第 1 波就不同（与每日形成对照）');
}

/* ───────────────────────── B. 端到端 ───────────────────────── */

head('B1. 战役：8 关跑通，行为与改动前一致（无生命、只有全通关才计 clears）');
{
  const h = run(MODE.campaign);
  const G = h.win.__G;
  ok(G.lives === 0, '战役没有生命概念');
  let guard = 0;
  while (G.phase !== 'over' && guard++ < 120){
    if (G.phase !== 'aim'){ frames(h, 1); continue; }
    B.playBall(h);
  }
  ok(G.phase === 'over', '战役跑完 8 关后结束，实际用了 ' + guard + ' 轮');
  ok(G.makes >= 8 && G.cleared >= 3, '对照组有效：打进 ' + G.makes + ' 球、通关 ' + G.cleared + ' 关');
  ok(h.els['lv'].textContent === (G.levelIndex+1) + '/8', 'HUD 关卡标签与实际一致');
  ok(h.els['endTitle'].textContent.indexOf('全部通关') >= 0 || h.els['endTitle'].textContent.indexOf('挑战结束') >= 0,
     '结算标题为战役文案：' + h.els['endTitle'].textContent);
  ok(h.win.__REC.clears === (G.cleared >= 8 ? 1 : 0), 'REC.clears 只在全通关时 +1，实际=' + h.win.__REC.clears);
  ok(h.win.__REC.endlessLv === 0 && h.win.__REC.dailyBest === 0, '战役局不污染无尽 / 每日的记录');
}

head('B2. 无尽：连续过关波次推进、生命回满、记录落库');
{
  const h = run(MODE.endless);
  const G = h.win.__G;
  let cleared = 0, guard = 0;
  while (G.phase !== 'over' && cleared < 4 && guard++ < 400){
    if (G.phase !== 'aim'){ frames(h, 1); continue; }
    // 用 G.cleared 数「过了几波」—— 早先看 levelIndex 变化是不对的：
    // 时间耗尽也会推进波次，那样会把「超时扣了一颗心」误当成顺利过关
    const c0 = G.cleared, li = G.levelIndex, s0 = G.attempts;
    let tries = 0;                       // 必须按迭代次数收敛，不能只看 attempts
    while (G.phase === 'aim' && G.levelIndex === li && tries++ < 12){
      if (G.levelPts >= G.lv.par) break;
      if (G.attempts - s0 >= 10) break;
      B.playBall(h);
    }
    if (G.cleared > c0) cleared++;
  }
  ok(cleared >= 4, '连续达标过了 ' + cleared + ' 波（对照组有效）');
  ok(G.levelIndex >= 4, '波次推进到第 ' + (G.levelIndex+1) + ' 波');
  ok(G.lives === 3, '连续达标时生命回满（上限 3），实际=' + G.lives);

  // 走到自然结束，才能验「记录落库」—— showEnd 只在结束时写 REC
  G.lives = 1; G.levelPts = 0;
  let f = 0;
  while (f++ < 3000 && G.phase !== 'over') frames(h, 1);
  ok(G.phase === 'over', '把最后一颗心耗掉后本局结束');
  const r = h.win.__REC;
  ok(r.endlessLv >= 5, 'REC.endlessLv 记到了最远波次=' + r.endlessLv);
  ok(r.endlessBest >= G.score, 'REC.endlessBest ≥ 本局分（' + r.endlessBest + ' ≥ ' + G.score + '）');
  ok(r.clears === 0, '无尽局不增加战役通关次数');
}

head('B3. 每日：走完 3 关，首次完成记连胜 1 天');
{
  const h = run(MODE.daily);
  const G = h.win.__G;
  ok(G.lives === 3, '每日开局 3 颗心');
  let guard = 0;
  while (G.phase !== 'over' && guard++ < 300){
    if (G.phase !== 'aim'){ frames(h, 1); continue; }
    const c0 = G.cleared, li = G.levelIndex, s0 = G.attempts;
    let tries = 0;
    while (G.phase === 'aim' && G.levelIndex === li && tries++ < 12){
      if (G.levelPts >= G.lv.par) break;
      if (G.attempts - s0 >= 10) break;
      B.playBall(h);
    }
  }
  ok(G.phase === 'over', '每日挑战走完 3 关后结束（实际进了 ' + (G.levelIndex+1) + ' 关）');
  ok(G.levelIndex === 2, '最后一关是第 3 关');
  ok(G.makes >= 3, '对照组有效：这一局真的打进了 ' + G.makes + ' 球');
  const r = h.win.__REC;
  ok(r.dailyStreak === 1, '首次完成 → 连胜 1 天，实际=' + r.dailyStreak);
  ok(r.dailyBest === G.score, 'REC.dailyBest 记为本局分 ' + r.dailyBest);
  ok(r.dailyDate > 20000101 && r.dailyDate < 30001232, 'dailyDate 存的是 YYYYMMDD：' + r.dailyDate);
  ok(r.endlessLv === 0 && r.clears === 0, '每日局不污染无尽 / 战役记录');
}

head('B4. 存档耐脏：新字段逐字段校验，坏字段不牵连好字段');
{
  const cases = [
    ['非法 JSON', '{'],
    ['空串', ''],
    ['null', 'null'],
    ['数组', '[]'],
    ['数字', '12345'],
    ['字符串', '"abc"'],
    ['dailyStreak 是字符串', JSON.stringify({dailyStreak:'99', dailyBest:1234, endlessBest:77})],
    ['数值超出上限', JSON.stringify({dailyStreak:1e9, endlessLv:1e12, endlessBest:'x'})],
    ['负数', JSON.stringify({dailyStreak:-5, endlessBest:-100})],
    ['NaN 序列化成 null', '{"dailyStreak":null,"endlessLv":null}'],
    ['全是合法值', JSON.stringify({best:100, plays:7, dailyStreak:3, dailyDate:20260101, endlessLv:12, endlessBest:999})]
  ];
  for (const [name, raw] of cases){
    let crashed = null, h;
    try { h = boot(freshStore({ 'nulan.record': raw })); frames(h, 3); }
    catch (e){ crashed = e; }
    ok(!crashed, '损坏存档「' + name + '」不抛异常' + (crashed ? '：' + crashed.message : ''));
    if (h){
      const R = h.win.__REC;
      const sane = Number.isInteger(R.dailyStreak) && R.dailyStreak >= 0 && R.dailyStreak <= 9999;
      ok(sane, '  ' + name + ' → dailyStreak 合法（' + R.dailyStreak + '）');
    }
  }
}
{
  const raw = JSON.stringify({best:1234, plays:7, dailyStreak:'99', endlessLv:12, endlessBest:999});
  const h = boot(freshStore({ 'nulan.record': raw }));
  frames(h, 3);
  const R = h.win.__REC;
  ok(R.best === 1234 && R.plays === 7 && R.endlessLv === 12 && R.endlessBest === 999, '合法字段照常恢复');
  ok(R.dailyStreak === 0, '坏字段 dailyStreak 单独丢弃，没有拖累其它字段');
}

head('B5. 隐私模式：localStorage 读写都抛异常时游戏照常');
{
  for (const which of ['get','set']){
    const store = B.throwingStore(which);
    let crashed = null;
    try {
      const h = boot(store);
      clickSeg(h, 'mode', MODE.endless);
      click(h, 'btnStart'); frames(h, 5);
      if (h.win.__G.phase !== 'aim') throw new Error('没能进入瞄准阶段');
      B.playBall(h);
      if (h.win.__G.makes < 1) throw new Error('没能打进一球');
    } catch (e){ crashed = e; }
    ok(!crashed, which + ' 抛异常时仍能开局并打进一球' + (crashed ? '：' + crashed.message : ''));
  }
}

head('B6. 设置损坏不影响游戏');
{
  for (const raw of ['{', 'null', '[]', '{"mode":"nope"}', '{"assist":"全屏"}', '123', '{"mode":true}']){
    let crashed = null;
    try {
      const h = boot(freshStore({ 'nulan.settings': raw }));
      clickSeg(h, 'mode', MODE.daily);
      click(h, 'btnStart'); frames(h, 3);
      if (h.win.__G.phase !== 'aim') throw new Error('phase=' + h.win.__G.phase);
      if (h.win.__G.mode !== 'daily') throw new Error('非法设置不该让模式回落成别的值，实际=' + h.win.__G.mode);
    } catch (e){ crashed = e; }
    ok(!crashed, '设置存档「' + raw + '」不会让游戏打不开' + (crashed ? '：' + crashed.message : ''));
  }
}

done();
