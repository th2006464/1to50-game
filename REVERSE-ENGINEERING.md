# 1to50 v3.9 (com.westriversw.b1to50) 逆向证据

来源:`~/Downloads/1to50-3-9.apk`(SHA-256 `a4c4ec5b1f186ed88940eb21d844e55d808dc650d73b571036f645d7c0910040`)
引擎:JADX headless 0.7.1(via REA MCP)。静态反编译观察,未执行 APK。

## 类结构(com.westriversw.b1to50)

GameScene / AnswerNode / QuestionNode / QuestionMgr / DataMgr / TimeScore / StarBox / StarNode / SoundModule / TextureMgr / MainScene / HighScoreScene 等;基于 AndEngine(org.anddev.andengine)。

## 核心机制(证据)

### InitData — ev_0d2fe75b…
- 计时归零、next=1、5×5 网格每格 `MakeCountClear()+MakeQuestion()`、`AddQuestion()` ×5

### AnswerNode.MakeQuestion — ev_d33945df…
- `m_iMakeCount==0` → 随机 `(rand % 25)+1`(1–25),循环直到 `UseNumber[v-1]` 未用并标记
- `m_iMakeCount==1` → 随机 `(rand % 26)+25`(25–50),同样查重(实际只剩 26–50 可用)
- `m_iMakeCount>=2` → 值=51,两个数字精灵都隐藏(空格)
- 显示:个位精灵 + 十位精灵拼两位数

推论:完整一局 = 每格恰好被消费两次,25 格 × 2 = 50 个数。

### GameScene.onSceneTouchEvent — ev_b698077b…
- 点按 → 命中格 `IsInRect` → 取第一个未回答 QuestionNode
- 值相等 → `SetAnswer()` + 格子 `ReMake()` + `AddQuestion()`;若该值==50 → `GameOver(true)`
- 不等 → `Miss()` + 震动 80ms(可设置关闭)

### AnswerNode.ReMake — ev_a4b7efb1…
- 动画序列:并行(0.4s 淡出+放大至1.3) → 0.1s 延迟 → 缩到 0 → 恢复透明度 → 0.15s 弹回 1.0
- 第 4 段子序列完成时调用 `MakeQuestion()` 换新数;播放音效 Play(1)

### GameScene.AddQuestion — ev_04e4a992…
- 所有问题节点 `NextPos()` 前移;`nextNumber>50` 则不再加
- 队尾追加 `SetValue(nextNumber++)`

### GameScene.GameOver — ev_e305255b…
- 停止播放、Game Over 图 0.2s 淡入、音效 Play(6)
- 胜利且时间>0.1s:记录时间;`IsStarBox()`(破纪录)→ 3s 后 ShowStarBox,否则 3s 后消息框

### TimeScore — ev_2d36aa54…
- 6 个数字位:Sec100/Sec10/Sec1 + 小数点 + MilliSec10/MilliSec1 → 秒(最多3位).百分秒(2位),向上计时

## 推断项(无直接证据,复刻时为设计选择)

- 帮助高亮触发时长(Tick 内逻辑未反编译,取 5s)
- 星星数量阈值(StarBox/StarNode 阈值未反编译,取 <15s=3星 / <25s=2星 / 其余1星)
- 音效使用 WebAudio 合成音,未提取原版权益资源(版权原因刻意不复刻)
