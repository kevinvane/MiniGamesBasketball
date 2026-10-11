'use strict';
/* ─────────────────────────────────────────────────────────────────────────
   共用的 Node 沙箱：把 ../index.html 里的 <script> 抠出来，在 vm 里跑一遍。

   之所以需要它：游戏是「单文件 + 全内联」的浏览器代码，没有导出任何东西，
   传统单元测试进不去。这个沙箱做三件事：
     1. 抠脚本 + 注入只读钩子（见 HOOKS）
     2. 用假的 DOM / Canvas / localStorage 把环境搭起来
     3. 用手动驱动的 requestAnimationFrame 代替真 RAF，于是「打一局游戏」
        在 Node 里是毫秒级的，不必开浏览器

   三条容易让回归变成「自欺欺人」的坑，这里明确处理掉了：
     · 每次 boot 都重建 DOM 与监听器表，否则第二次 fire 会同时触发两局的 handler
     · querySelectorAll('[data-xxx]') 必须真的按属性返回元素，
       否则 syncAssistUI / syncModeUI 根本没被执行到，测试却会「通过」
     · 对照组的有效性本身要断言（见 00-smoke.js）：
       先证明脚本能跑出真实对局，再去测别的
   ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_PATH = process.env.NULAN_HTML
  || path.join(__dirname, '..', 'index.html');
const SRC = fs.readFileSync(HTML_PATH, 'utf8');
const JS = SRC.match(/<script>([\s\S]*?)<\/script>/)[1];

/* 往 IIFE 尾部注入测试钩子。
   注意：注入点必须紧贴 requestAnimationFrame(loop); 之前 ——
   早前踩过的坑是注入用的正则把 loop() 一起吃掉了，
   结果是测试「什么都没跑也通过」。所以下面立刻自检一次，
   注入不上就直接抛错，不留「静默没生效」的可能。 */
const HOOKS = `
window.__G = g; window.__REC = REC; window.__SETTINGS = SETTINGS; window.__LEVELS = LEVELS;
window.__levelAt = levelAt; window.__drawLevel = drawLevel; window.__levelSolvable = levelSolvable;
window.__simulateShot = simulateShot; window.__solveOnce = solveOnce; window.__releaseOrigin = releaseOrigin;
window.__loadLevel = loadLevel; window.__advanceLevel = advanceLevel; window.__startGame = startGame;
window.__runLength = runLength; window.__runComplete = runComplete; window.__levelLabel = levelLabel;
window.__gainLife = gainLife; window.__loseLife = loseLife;
window.__showEnd = showEnd; window.__finishDaily = finishDaily; window.__curStreak = curStreak;
window.__RELEASE_DELAY = RELEASE_DELAY; window.__LIVES_MAX = LIVES_MAX; window.__MODE_CAMPAIGN = MODE_CAMPAIGN;
window.__MODE_ENDLESS = MODE_ENDLESS; window.__MODE_DAILY = MODE_DAILY; window.__MODES = MODES;
window.__hookOK = true;
`;
const PATCHED = JS.replace(/\nrequestAnimationFrame\(loop\);/, HOOKS + 'requestAnimationFrame(loop);');
if (!/window\.__hookOK/.test(PATCHED)) {
  throw new Error('钩子注入失败：index.html 的脚本结构变了（找不到 requestAnimationFrame(loop); 那一行）');
}

/* 从真实 HTML 里扫出带 data-* 的元素，按出现顺序建索引，
   这样 querySelectorAll('[data-assist]') 才有真实的返回顺序 */
const DATA_ATTRS = {};
{
  const tagRe = /<[a-zA-Z][^>]*>/g;
  let m;
  while ((m = tagRe.exec(SRC))){
    const a = /data-([a-z-]+)\s*=/.exec(m[0]);
    if (!a) continue;
    const name = a[1];
    (DATA_ATTRS[name] || (DATA_ATTRS[name] = [])).push(m[0]);
  }
}

const noop = () => {};
let clock = 0;

function makeCtx(){
  // 路径调用的计数：某些优化断言要数「每帧发出了多少条绘制指令」
  const ctx = {
    canvas:{width:0,height:0,style:{}},
    setTransform:noop, save:noop, restore:noop, translate:noop, scale:noop,
    rotate:noop, clearRect:noop, fillRect:noop, strokeRect:noop, beginPath:noop,
    rect:noop, roundRect:noop, ellipse:noop, closePath:noop, fillText:noop,
    setLineDash:noop, clip:noop, moveTo:noop, lineTo:noop, bezierCurveTo:noop,
    drawImage:noop, fill:noop, stroke:noop,
    measureText:() => ({width:10}),
    createRadialGradient:() => ({addColorStop:noop}),
    createLinearGradient:() => ({addColorStop:noop})
  };
  ['arc','fill','stroke','fillRect','drawImage','beginPath','strokeText','fillText','lineTo','moveTo']
    .forEach(k => { ctx[k] = function(){ ctx.__n = (ctx.__n||0)+1; }; });
  ctx.__reset = () => { ctx.__n = 0; };
  return ctx;
}

function mkEl(id){
  const el = {
    id, textContent:'', innerHTML:'', className:'', style:{},
    attrs:{}, children:[], __L:{},
    classList:{
      _s:new Set(),
      add(c){ this._s.add(c); },
      remove(c){ this._s.delete(c); },
      contains(c){ return this._s.has(c); },
      toggle(c, on){
        if (on === undefined) on = !this._s.has(c);
        on ? this._s.add(c) : this._s.delete(c);
      }
    },
    addEventListener(t, f){ (el.__L[t] || (el.__L[t] = [])).push(f); },
    removeEventListener:noop, setPointerCapture:noop,
    getContext:makeCtx,
    getBoundingClientRect:() => ({left:0, top:0, width:960, height:600}),
    setAttribute(k, v){ el.attrs[k] = String(v); },
    getAttribute(k){ return k in el.attrs ? el.attrs[k] : null; },
    appendChild(c){ el.children.push(c); return c; }
  };
  Object.defineProperty(el, 'width',  {get(){return el.__w||0}, set(v){el.__w=v}});
  Object.defineProperty(el, 'height', {get(){return el.__h||0}, set(v){el.__h=v}});
  return el;
}

/** 起一个「浏览器」。每次调用都是一次全新的页面加载。 */
function boot(store){
  const els = {};
  const byId = id => els[id] || (els[id] = mkEl(id));
  const byAttr = {};
  for (const name in DATA_ATTRS){
    byAttr[name] = DATA_ATTRS[name].map((tag, i) => {
      const el = mkEl('@' + name + '.' + i);
      const v = new RegExp('data-' + name + '\\s*=\\s*"([^"]*)"').exec(tag);
      el.attrs['data-' + name] = v ? v[1] : '';
      return el;
    });
  }
  const doc = {
    getElementById: byId,
    createElement: () => mkEl('#new'),
    querySelectorAll: sel => {
      const m = /data-([a-z-]+)/.exec(sel);
      return m ? (byAttr[m[1]] || []).slice() : [];
    },
    addEventListener: noop
  };
  const win = { devicePixelRatio:1, addEventListener:noop, performance:{now:() => clock}, __raf:null };
  const sb = {
    document:doc, window:win, console, localStorage:store,
    requestAnimationFrame: f => { win.__raf = f; return 1; },
    performance: win.performance, devicePixelRatio:1,
    Math, Date, JSON, parseFloat, parseInt, isNaN, Object, Array, String, Number, Set, Map,
    setTimeout: () => 0, clearTimeout: noop
  };
  sb.globalThis = sb; win.document = doc; win.localStorage = store;
  win.requestAnimationFrame = sb.requestAnimationFrame;
  vm.createContext(sb);
  vm.runInContext(PATCHED, sb, {filename:'game.js'});
  return { sb, win, els, doc, byAttr };
}

function freshStore(seed){
  const s = Object.assign({}, seed || {});
  return {
    getItem: k => (k in s ? s[k] : null),
    setItem: (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; },
    _raw: s
  };
}
/** localStorage 的 get / set 各自抛异常，模拟隐私模式与配额满 */
function throwingStore(which){
  return {
    getItem: k => { if (which === 'get') throw new Error('denied'); return null; },
    setItem: (k, v) => { if (which === 'set') throw new Error('denied'); },
    removeItem: noop
  };
}

/** 驱动 n 帧（60fps） */
function frames(h, n){
  for (let i = 0; i < n; i++){
    clock += 1000/60;
    const f = h.win.__raf;
    if (!f) break;
    h.win.__raf = null;
    f(clock);
  }
}
/** 点击某个 id 的按钮，并推进 n 帧等 UI 同步 */
function click(h, id, n = 2){
  const el = h.els[id];
  if (!el) throw new Error('找不到元素 ' + id);
  (el.__L.click || []).forEach(f => f({target:el}));
  frames(h, n);
}
/** 点第 k 个 data-xxx 分段按钮（0 起） */
function clickSeg(h, attr, k, n = 2){
  const btns = h.byAttr[attr] || [];
  if (!btns[k]) throw new Error('找不到第 ' + k + ' 个 data-' + attr);
  (btns[k].__L.click || []).forEach(f => f({target:btns[k]}));
  frames(h, n);
}
function isChecked(h, attr, val){
  return (h.byAttr[attr] || []).some(b =>
    b.getAttribute('data-' + attr) === val && b.getAttribute('aria-checked') === 'true');
}

/* ── 机器人：一个「水平中等」的自动射手，用来代替真人验证玩法 ──
   扫描范围是「直线瞄准篮心 ±0.55rad」而不是全角：全角要扫 6 万条弹道（1.6 秒一球），
   而远处的篮本来就只可能被那一小段角度命中，够用且快两个数量级。

   ⚠ 踩过的坑（回归脚本自己也会骗人）：
   一开始这里写了 `G.lv.timer += RELEASE_DELAY`「把求解时刻推到球真正出手的时刻」，
   结果移动篮架关上莫名其妙地一直打铁。原因是 **simulateShot 内部已经加过
   RELEASE_DELAY 了** —— 它的入参就是「出手点」，篮架的时间基准由它自己处理。
   外面再加一次，等于把移动篮架的相位提前了整整一个 RELEASE_DELAY（~0.54s × 98px/s ≈ 50px），
   于是求解器挑出来的杆，实机打出去偏差 50px 以上，怎么调参数都没用。
   教训：给求解器喂时间基准之前，先确认它内部有没有已经处理过这一层。 */
function solveBest(h){
  const G = h.win.__G;
  let best = null;
  const ref = h.win.__releaseOrigin(0);
  const a0 = Math.atan2(ref.y - G.lv.hoopY, G.lv.hoopX - ref.x);
  for (let ai = 0; ai < 21; ai++){
    const a = a0 - .55 + 1.1*ai/20;
    if (a < .03 || a > 1.45) continue;
    const o = h.win.__releaseOrigin(a);
    for (let sp = 380; sp <= 1520; sp += 16){
      const s = h.win.__simulateShot(o.x, o.y, Math.cos(a)*sp, -Math.sin(a)*sp, {pts:false, fast:true});
      if (s.scored && s.arrive && (!best || s.arrive.err < best.err)) best = { a, sp, err: s.arrive.err };
    }
  }
  return best;
}
/** 拖拽出手：pointerdown / pointermove / pointerup 走真实事件通路 */
function drag(h, shot){
  const G = h.win.__G;
  const sx = G.ball.x, sy = G.ball.y, dragPx = Math.min(shot.sp/8, 190);
  const px = sx - Math.cos(shot.a)*dragPx, py = sy + Math.sin(shot.a)*dragPx;
  const cv = h.els['cv'];
  const mk = (t,x,y) => ({type:t, pointerId:1, clientX:x, clientY:y, target:cv, currentTarget:cv});
  cv.__L.pointerdown.forEach(f => f(mk('pointerdown', sx, sy)));
  cv.__L.pointermove.forEach(f => f(mk('pointermove', px, py)));
  cv.__L.pointerup.forEach(f => f(mk('pointerup', px, py)));
}
/** 打一球。返回 { made, skipped }。无解时最多空转 waitLimit 帧就收手。 */
function playBall(h, maxFrames = 700, waitLimit = 1600){
  const G = h.win.__G;
  const before = G.score;
  const s = solveBest(h);
  if (!s){                              // 无解（理论上不该发生）→ 让时间走完本关
    let f = 0;
    while (f++ < waitLimit && G.phase !== 'aim' && G.phase !== 'over') frames(h, 1);
    return { made:false, skipped:true };
  }
  drag(h, s);
  let f = 0;
  while (f++ < maxFrames && G.phase !== 'aim' && G.phase !== 'over') frames(h, 1);
  return { made: G.score > before, skipped:false };
}

let pass = 0, fail = 0;
const failures = [];
function ok(cond, msg){
  if (cond){ pass++; console.log('  PASS | ' + msg); }
  else { fail++; failures.push(msg); console.log('  FAIL | ' + msg); process.exitCode = 1; }
}
function head(t){ console.log('\n=== ' + t + ' ==='); }
function done(){
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail){ console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); }
  return fail;
}

module.exports = {
  boot, freshStore, throwingStore, frames, click, clickSeg, isChecked,
  solveBest, drag, playBall, ok, head, done,
  SRC, HTML_PATH,
  get pass(){ return pass; }, get fail(){ return fail; }
};
