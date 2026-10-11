'use strict';
/* 00 · 沙箱自身有效性（对照组）
   —— 先证明「这套脚本真的能跑出一局真实对局」，再去测别的。
   回归脚本自己骗人的教训：对照组无效时，「什么都没跑也通过」比失败更可怕。 */

const B = require('./boot');
const { boot, freshStore, frames, click, head, ok, done } = B;

head('A. 钩子注入');
const h = boot(freshStore());
const G = h.win.__G;
ok(!!G, '钩子注入成功，能拿到游戏内部状态');
ok(G.phase === 'menu', '初始停在 menu 阶段，实际=' + G.phase);
ok(!!h.win.__LEVELS && h.win.__LEVELS.length === 8, '能拿到 8 关配置');

head('B. 开局');
click(h, 'btnStart');
frames(h, 3);
ok(G.phase === 'aim', '点「开始游戏」进入瞄准阶段，实际=' + G.phase);
ok(h.win.__REC.plays === 1, 'plays 计到 1，实际=' + h.win.__REC.plays);

head('C. 拖拽 → 跳投 → 飞行 → 得分（全链路）');
const shot = B.solveBest(h);
ok(!!shot, '能从第 1 关搜出一杆必进的球（命中误差 ' + (shot ? shot.err.toFixed(2) + 'px' : '-') + '）');

const sx = G.ball.x, sy = G.ball.y;
const dragPx = Math.min(shot.sp/8, 190);
const cv = h.els['cv'];
const mk = (t,x,y) => ({type:t, pointerId:1, clientX:x, clientY:y, target:cv, currentTarget:cv});
cv.__L.pointerdown.forEach(f => f(mk('pointerdown', sx, sy)));
cv.__L.pointermove.forEach(f => f(mk('pointermove', sx - Math.cos(shot.a)*dragPx, sy + Math.sin(shot.a)*dragPx)));
cv.__L.pointerup.forEach(f => f(mk('pointerup', sx - Math.cos(shot.a)*dragPx, sy + Math.sin(shot.a)*dragPx)));
frames(h, 4);
ok(G.phase === 'shoot', '松手后进入跳投，实际=' + G.phase);

for (let i = 0; i < 700 && G.phase !== 'aim' && G.phase !== 'over'; i++) frames(h, 1);
ok(G.makes >= 1, '这一杆真的进了：makes=' + G.makes + ' 得分=' + G.score);
ok(G.attempts >= 1, 'attempts 记到了出手次数=' + G.attempts);
ok(G.score > 0, '总分在涨，实际=' + G.score);

console.log('  [对照] makes=' + G.makes + ' score=' + G.score + ' phase=' + G.phase);
ok(G.makes >= 1 && G.score > 0,
   '对照组有效：沙箱能跑出真实对局（后续所有断言以此为前提）');

done();
