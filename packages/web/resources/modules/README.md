# 可选公共模块

`waves.ts` 提供 WaveScheduler。用途为分批出现的敌人、障碍或目标，不限定游戏类型；不依赖 Phaser，也不创建敌人、计分或发放奖励。

构造参数为波次清单和 `spawn(wave, index)` 回调。场景每次更新调用 `update(deltaMs)`；卸载或重新开始调用 `stop()`，新一局创建新实例。`complete` 只表示调度结束，不表示所有敌人已经消失。时间单位为毫秒，异常大时间步长限制为 100ms。

版本 0.1.0。按需复制到项目 `src/modules` 并记录 modules.lock.json。可自由编写缺失能力；对公共模块的本地修改必须记录来源。

设计起点为现有 tower_defense WaveManager 的调度职责，剥离了 Scene、敌人计数与奖励。跨玩法验收仍待完成，当前不宣称已经验证所有组合。
