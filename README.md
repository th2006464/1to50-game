# 1to50-game

经典反应小游戏 **1to50** 的 HTML5 复刻版,Cloudflare Workers 部署,PWA 可安装,带 D1 世界排行榜。

> 玩法逻辑通过逆向原 Android 版 `com.westriversw.b1to50` v3.9 (APK) 还原,
> 逆向过程与证据见 [REVERSE-ENGINEERING.md](REVERSE-ENGINEERING.md)。

**在线玩:** https://1to50.game.foxtang.com

## 玩法

- 5×5 棋盘上初始随机铺满 **1–25**
- 按 **1 → 50** 的顺序点击数字
- 每答对一格,该格会翻转成 **26–50** 中的新数字,一直点到 50
- 答错会闪红并震动(移动端)
- 计时向上,越快越好;通关自动上榜,可查看世界排名

## 架构

```
├── public/              # 静态前端(Workers Assets 托管)
│   ├── index.html / style.css / game.js
│   ├── manifest.webmanifest + service-worker.js   # PWA
│   └── icons/
├── src/index.js         # Worker:/api/score 提交成绩、/api/leaderboard 排行榜
├── migrations/          # D1 表结构(one_to_fifty_scores)
└── wrangler.jsonc       # Cloudflare 配置(自定义域名 1to50.game.foxtang.com)
```

排行榜对应原版的 `RankWorldLayer`(云端),本地最佳对应 `RankLocalLayer`(localStorage)。

## 本地开发

```bash
npm install
npx wrangler dev      # http://localhost:8787,本地含 D1 模拟
```

## 部署

使用与其他游戏共用的 D1 数据库 `game-data`，本游戏使用独立的成绩表和迁移记录表。

```bash
npx wrangler d1 migrations apply game-data --remote
npx wrangler deploy
```

## 与原版的一致性

| 机制 | 原版(反编译确认) | 本复刻 |
|------|------------------|--------|
| 棋盘 | 5×5,初始不重复 1–25 | ✅ |
| 补数 | 答对后补 26–50 未用数,一局 25格×2轮=50 | ✅ |
| 目标队列 | 初始 5 个,答一补一 | ✅ |
| 答错 | Miss 闪烁 + 震动 80ms | ✅ |
| 计时 | 秒.百分秒,向上 | ✅ |
| 开局 | 3-2-1-GO 倒计时 | ✅ |
| 结算 | 3s 后弹框,破纪录星星 | ✅(阈值系推断) |
| 排行榜 | 本地 + 世界(Facebook) | ✅ 本地 + D1 世界 |

不复刻的内容(有意为之):原版美术/音效资源(版权)、广告 SDK、Facebook 登录。

## 许可

本复刻为独立实现,代码以 MIT 许可发布;不包含原作任何资源。
"1to50" 原作版权归其作者所有,本项目仅供学习研究。
