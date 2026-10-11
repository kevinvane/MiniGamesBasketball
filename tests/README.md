# 回归测试

游戏本体是**单文件零依赖**的 `index.html`，这��套测试只在开发时用，不需要构建、不需要 npm install。

```bash
node tests/run-all.js              # 跑全部（约 70s）
node tests/run-all.js 02           # 只跑文件名含 "02" 的套件
node tests/run-all.js --html 备份.html   # 拿另一份 index.html 来测（对比改动前后）
```

退出码 `0` = 全过，`1` = 有失败。改完 `index.html` 跑一次就知道有没有把玩法改坏。

**自动化测不到的那部分**（新 UI 长什么样、窄屏会不会挤、三种模式好不好玩、
辅助线看着顺不顺眼）见 [`MANUAL-CHECK.md`](MANUAL-CHECK.md) —— 那份是人眼验证清单。

---

## 为什么需要它

游戏没有导出任何东西，浏览器代码传统单元测试进不去。`boot.js` 做的事是：
把 `<script>` 抠出来 → 用假的 DOM / Canvas / `localStorage` 搭环境 →
用手动驱动的 `requestAnimationFrame` 代替真 RAF。

于是**「打一局完整对局」在 Node 里是毫秒级的**，不必开浏览器就能验证玩法。

---

## 套件

| 文件 | 管什么 | 大概耗时 |
|---|---|---|
| `boot.js` | 沙箱 + 机器人求解器（被测对象是 `../index.html`） | — |
| `lib/baseline-sim.js` | **重构前的 `simulateShot` 原版**，只给 02 当比对基准 | — |
| `00-smoke.js` | 沙箱自身有效性：先证明能跑出真实对局 | 1s |
| `01-gen.js` | 关卡生成：性能、可解性、确定性、难度曲线、合法性 | 5s |
| `02-physics.js` | `simulateShot` 新旧**逐点等价** + 求解器↔实机闭环 | 2s |
| `03-modes.js` | 三模式规则：生命 / 连胜 / 结束条件 / 存档耐脏 / 隐私模式 | 8s |
| `04-campaign.js` | 战役 8 关求解器：每关都有解、移动篮架所有相位都能打 | 4s |
| `05-par.js` | `par` 够不够得着（机器人实打一局无尽） | 2s |
| `run-all.js` | 入口 | — |

---

## 三条必须知道的规矩

**① 对照组的有效性本身要断言。**
先证明脚本能跑出真实对局，再去测别的。否则会「什么都没跑也通过」——
`boot.js` 注入钩子后会自检 `requestAnimationFrame(loop);` 那一行还在，
每个套件开头也都会断言「机器人真的打进 N 球」。

**② 断言要读游戏自己的计数器，不要从外部现象反推。**
「过关了」要看 `g.cleared`，而不是 `levelIndex` 变化 —— 时间耗尽也会推进关卡号。

**③ 内层循环一定要有与「有没有出手」无关的计数器。**
`solveBest` 找不到解时不会出手，`attempts` 不变；只盯着 `attempts` 的循环会死锁。
`05-par.js` 第一次跑就挂在这儿。

---

## 改游戏时的常见配套动作

| 改了什么 | 必须同步 |
|---|---|
| `simulateShot` 的积分 / 碰撞 / 判定 | `lib/baseline-sim.js`，然后跑 02 的 B 节做新旧比对 |
| `RELEASE_DELAY` / `CROUCH_T` / `RISE_T` | `lib/baseline-sim.js` 的 `FIXED_REL`，以及 02 的 D 节 |
| `LEVELS` 数组 | `04-campaign.js` 里的 `expect` 硬编码表 |
| `REC_DEF` / `REC_MAX` | `03-modes.js` 的存档耐脏用例 |
| 关卡生成参数 `drawLevel` | `01-gen.js` 的性能与合法性断言 |

---

## 两个容易踩的坑

**① 基准与被测物必须用同一套时间基准。**
`lib/baseline-sim.js` 的 `relDelay` 必须跟着游戏当前的 `RELEASE_DELAY` 走。
拿两套时间基准去比，移动篮架关会差出 1.3px 的系统偏差 —— 比出来的全是噪声，不是回归。
（`ORIGINAL_REL` 保留了 P2-7 修正前的值，02 的 E 节用它量化那次修正的影响。）

**② `g.lv.timer` 只在有移动篮架的关卡里走。**
`updateLevelMotion()` 在 `mover == null` 时直接 return，
所以静止关卡的 `g.lv.timer` 恒为 0。测「经过了多少时间」要数**帧**，
别拿 timer 的差值，否则会得到「0 帧」的错误结论。

---

## 已修的历史问题

`RELEASE_DELAY` 曾比实机实际出手时刻少 **0.8 帧**（32.2 vs 33），
因为跳投状态机按整帧推进、下蹲要跑满 `ceil(0.17*60) = 11` 帧而不是 `0.17` 秒。
导致 y 轴移动篮架上「球顶点 ≈ 篮圈高度」时预览说能进、实机穿不过篮圈平面。

已修（P2-7）。02 的 C、D 两节是回归护栏：前者要求 8 关闭环全通，
后者要求 `RELEASE_DELAY` 与实测出手帧数一致。
