'use strict';
/* 重构前的 simulateShot —— 原版逐字照搬，作为「等价性回归」的基准。
   它和 ../index.html 里的那份**故意不一样**：每帧新建矩形清单、
   hoopAt 每帧返回新对象、circleRect 每帧返回新对象、也没有 fast 提前收工。
   02-physics.js 拿它跟现版逐点比对。
   不要「顺手优化」这份文件 —— 它越朴素，作为基准越可信。

   ⚠ 唯一的参数是 relDelay（模拟器假定的「松手 → 球脱手」延迟）。
     它必须**跟着游戏当前的 RELEASE_DELAY 传进来**，否则拿两套时间基准比，
     移动篮架关的弹道会差出 1.3px 的系统偏差，比出来的全是噪声、不是回归。
     基准要比的是「积分 / 碰撞 / 判定有没有被改坏」，不是「时间常量对不对」。

     ORIGINAL_REL 保留 P2-7 修好之前的值（32.2 帧），供 02 量化这次修正的影响：
     同一个物理，两套时间基准，差多少。                                    */

const W = 960, H = 600, GY = H - 58, BR = 19, RR = 7, GRAV = 1500, DRAG = 0.09;
const ARM = 36, HIP = 46, SHO = 38, JUMPH = 96;
const JV = Math.sqrt(2 * GRAV * JUMPH);
const RISE_T = Math.ceil(JV / (GRAV/60)) / 60;              // = 22/60
const ORIGINAL_REL = 0.17 + RISE_T;                         // P2-7 之前：32.2 帧
const FIXED_REL    = Math.ceil(0.17 * 60) / 60 + RISE_T;   // P2-7 之后：33 帧

function jumpApex(dt){
  const step = GRAV*dt;
  const n = Math.max(1, Math.min(4096, Math.ceil(JV/step)));
  let y = 0, vy = -JV;
  for (let i = 0; i < n; i++){ vy += step; y += vy*dt; }
  return y;
}
function releaseOrigin(ang, apex){
  const a = -ang;
  return { x: 200 + 2 + Math.cos(a)*ARM, y: GY + apex - HIP - SHO + Math.sin(a)*ARM };
}
function circleRect(cx, cy, r, rc){
  const nx = Math.max(rc.x, Math.min(cx, rc.x + rc.w));
  const ny = Math.max(rc.y, Math.min(cy, rc.y + rc.h));
  let dx = cx-nx, dy = cy-ny;
  const d2 = dx*dx+dy*dy;
  if (d2 > r*r) return null;
  const d = Math.sqrt(d2) || .0001;
  if (d2 > 1e-6){
    dx/=d; dy/=d;
    return { nx: cx + dx*(r-d), ny: cy + dy*(r-d), dx, dy, depth: r-d };
  }
  const l = cx-rc.x, r2 = rc.x+rc.w-cx, tp = cy-rc.y, bt = rc.y+rc.h-cy;
  const m = Math.min(l,r2,tp,bt);
  if (m === l) return { nx:rc.x-r,        ny:cy, dx:-1, dy:0, depth:r };
  if (m === r2) return { nx:rc.x+rc.w+r, ny:cy, dx: 1, dy:0, depth:r };
  if (m === tp) return { nx:cx,           ny:rc.y-r,         dx:0, dy:-1, depth:r };
  return         { nx:cx,           ny:rc.y+rc.h+r, dx:0, dy: 1, depth:r };
}

/** 与 index.html 中同名函数同参数、同返回结构；lv 需带 timer 字段
 *  relDelay 省略时用 FIXED_REL（须与游戏当前的 RELEASE_DELAY 一致） */
function simulateShot(px, py, vx, vy, lv, relDelay){
  const REL = relDelay === undefined ? FIXED_REL : relDelay;
  const dt = 1/60;
  const pts = [];
  let x = px, y = py, a = vx, b = vy, t = 0;
  let scored = false, rimHit = false, boardHit = false, mark = false;
  let firstCross = null, arrive = null;
  const hoopAt = (tOff) => {
    const m = lv.mover;
    if (!m) return { cx: lv.hoopX, cy: lv.hoopY };
    const off = Math.sin((lv.timer + tOff) * m.speed) * m.amp;
    return { cx: lv.hoopX + (m.axis === 'x' ? off : 0), cy: lv.hoopY + (m.axis === 'y' ? off : 0) };
  };
  for (let i = 0; i < 400; i++){
    const hp = hoopAt(REL + t);
    const prevX = x, prevY = y;
    a += (lv.wind || 0)*dt;
    b += GRAV*dt;
    const d = 1 - DRAG*dt;
    a *= d; b *= d;
    x += a*dt; y += b*dt;
    t += dt;

    if (b > 0 && prevY <= hp.cy && y >= hp.cy){
      const k = (hp.cy - prevY) / ((y - prevY) || 1);
      const xc = prevX + (x - prevX)*k;
      if (!firstCross) firstCross = { cx:hp.cx, cy:hp.cy, x:xc, t:t-dt+k*dt, err:Math.abs(xc-hp.cx) };
      if (!scored && firstCross.err <= lv.rim/2 - 4){ scored = true; mark = true; arrive = firstCross; }
    }
    const rects = [
      { x:hp.cx + lv.rim/2 + 3, y:hp.cy - 100, w:18, h:102, board:1 },
      { x:hp.cx + lv.rim/2 + 7, y:hp.cy + 2,   w:12, h:GY - hp.cy }
    ].concat(lv.blocks || []);
    for (let k = 0; k < rects.length; k++){
      const hit = circleRect(x, y, BR, rects[k]);
      if (!hit) continue;
      x = hit.nx; y = hit.ny;
      const vn = a*hit.dx + b*hit.dy;
      if (vn < 0){
        a -= 1.55*vn*hit.dx; b -= 1.55*vn*hit.dy; a *= .62; b *= .62;
        mark = true;
        if (rects[k].board) boardHit = true;
      }
    }
    for (const s of [-1, 1]){
      const rx = hp.cx + s*lv.rim/2, ry = hp.cy, rr = RR + BR;
      const dx = x-rx, dy = y-ry, d2 = dx*dx + dy*dy;
      if (d2 < rr*rr){
        const dd = Math.sqrt(d2) || 1e-4, nx = dx/dd, ny = dy/dd;
        x = rx + nx*rr; y = ry + ny*rr;
        const vn = a*nx + b*ny;
        if (vn < 0){
          a -= 1.62*vn*nx; b -= 1.62*vn*ny; a *= .86; b *= .86;
          if (!rimHit){ rimHit = true; mark = true; }
        }
      }
    }
    if (y + BR > GY){ y = GY - BR; if (b > 0){ b *= -0.52; a *= .78; } else b = 0; }
    if (x < BR){ x = BR; if (a < 0) a *= -0.55; }
    if (x > W - BR){ x = W - BR; if (a > 0) a *= -0.55; }

    if (i % 2 === 0) pts.push({ x, y, m: mark });
    if (y > H + 40 || x < -80 || x > W + 80) break;
    if (b > 0 && y >= GY - BR - 1 && Math.hypot(a,b) < 62) break;
  }
  return { pts, scored, rimHit, boardHit, arrive: arrive || firstCross };
}

module.exports = { simulateShot, jumpApex, releaseOrigin,
                   ORIGINAL_REL, FIXED_REL,
                   W, H, GY, BR, RR, GRAV, DRAG, MAX_SPEED: 1520,
                   ARM, HIP, SHO, JUMPH };
