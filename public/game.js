/* 1to50 — HTML 复刻版
 * 玩法逻辑逆向自 com.westriversw.b1to50 v3.9(见仓库 REVERSE-ENGINEERING.md):
 *  - 5×5 棋盘,初始随机铺满不重复的 1–25        (AnswerNode.MakeQuestion, m_iMakeCount==0)
 *  - 答对后格子换为 26–50 中未用的随机数        (m_iMakeCount==1,一局恰好 25格×2轮=50)
 *  - 目标队列:从 1 开始,初始 5 个,答一补一       (GameScene.AddQuestion / InitData)
 *  - 答错:Miss 闪烁 + 震动 80ms                  (onSceneTouchEvent)
 *  - 计时:向上,格式 秒.百分秒                    (TimeScore: Sec100..1 . MilliSec10..1)
 *  - 胜利:点到 50 → GameOver(true) → 播放结算音 → 3s 后弹框 (GameScene.GameOver → Play(6))
 *  - 设置:音效/震动开关,持久化                    (DataMgr.m_bSound/m_bVibration + LoadData/SaveData)
 *  - 星星:>65s=0,每快5s+1,≤20s=10                 (DataMgr.GetStarCount,逐字还原)
 *  - 主菜单:原版 MainScene,开始前可准备,点了才倒计时
 *  - 帮助亮光:2s 无正确点击触发,亮光层呼吸循环      (GameScene.Tick + AnswerNode.Light)
 *    (0.5s 淡入放大至1.05 → 0.5s 淡出,循环至点中该格)
 *  - 超时:300s 判负回主菜单                        (GameScene.Tick)
 * 未取证的设计选择:音效音色(WebAudio 合成)。
 */
"use strict";

const SIZE = 5, TOTAL = 50, TARGET_QUEUE_LEN = 5;
const HELP_DELAY = 2.0;          // 原版 Tick:距上次正确点击 ≥2.0s 触发 HelpOn()
const TIME_LIMIT = 300.0;        // 原版 Tick:m_fTime > 300 → GameOver(false) 超时判负

/* 星星数(逐字复刻 DataMgr.GetStarCount):>65→0,每快5秒+1,≤20→10 */
function getStarCount(t) {
  if (t > 65) return 0;
  if (t > 60) return 1;
  if (t > 55) return 2;
  if (t > 50) return 3;
  if (t > 45) return 4;
  if (t > 40) return 5;
  if (t > 35) return 6;
  if (t > 30) return 7;
  if (t > 25) return 8;
  return t > 20 ? 9 : 10;
}

/* ---------- 设置(对应原版 DataMgr.m_bSound / m_bVibration + LoadData/SaveData) ---------- */
const settings = {
  sound: localStorage.getItem("1to50.sound") !== "0",
  vibration: localStorage.getItem("1to50.vibration") !== "0",
};
function saveSettings() {
  localStorage.setItem("1to50.sound", settings.sound ? "1" : "0");
  localStorage.setItem("1to50.vibration", settings.vibration ? "1" : "0");
}

const $ = (id) => document.getElementById(id);
const boardEl = $("board"), timerEl = $("timer"), overlayEl = $("overlay");
const countdownEl = $("countdown"), gameoverEl = $("gameover");
const queueCurrentEl = $("queue-current"), queueNextEl = $("queue-next");
const bestEl = $("best-value");

/* ---------- 状态 ---------- */
let tiles = [];          // {value, makeCount, el}
let used = [];           // 1..50 已在场上出现过的标记(原版 DataMgr.UseNumber)
let queue = [];          // 问题节点 {value, answered}(原版 m_pQuestion)
let nextNumber = 1;      // 原版 m_iNextNumber
let playing = false;
let timeStart = 0, timeFrozen = 0;
let lastHitAt = 0, helpShown = false;   // 原版 m_fHelpLightTime / m_bHelpLightUse
let best = parseFloat(localStorage.getItem("1to50.best")) || null;

/* ---------- 云端排行(原版 RankWorldLayer;本地 best 对应 RankLocalLayer) ---------- */
const clientId =
  localStorage.getItem("1to50.clientId") ||
  localStorage.setItem("1to50.clientId", (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join(""))) ||
  localStorage.getItem("1to50.clientId");

async function submitScore(timeSeconds) {
  const saved = localStorage.getItem("1to50.name");
  if (saved) return doSubmit(saved, timeSeconds);
  // 首次通关:结算框内输入昵称再上榜(避免被 webview 拦截的 prompt)
  $("go-name-row").classList.add("show");
  $("go-name-input").value = "";
  return new Promise((resolve) => {
    $("btn-submit-name").onclick = async () => {
      const v = $("go-name-input").value.trim().slice(0, 16) || "匿名玩家";
      localStorage.setItem("1to50.name", v);
      $("go-name-row").classList.remove("show");
      await doSubmit(v, timeSeconds);
      resolve();
    };
  });
}
async function doSubmit(name, timeSeconds) {
  try {
    const r = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, playerName: name, timeSeconds }),
    });
    const d = await r.json();
    $("go-rank").textContent = d.ok ? `世界排名 #${d.rank}` : "成绩提交失败";
  } catch (e) { $("go-rank").textContent = "离线，成绩未上传"; }
}

async function showLeaderboard() {
  const modal = $("rank-modal"), list = $("rank-list");
  modal.classList.add("show");
  list.innerHTML = "<li>加载中…</li>";
  try {
    const d = await (await fetch("/api/leaderboard")).json();
    list.replaceChildren();
    if (!d.ok) throw new Error("排行榜加载失败");
    if (!d.entries.length) list.innerHTML = "<li>还没有人通关,来当第一个!</li>";
    d.entries.forEach((entry, index) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const time = document.createElement("span");
      name.className = "rn"; time.className = "rt";
      name.textContent = `${index + 1}. ${entry.playerName}`;
      time.textContent = `${fmt(entry.timeSeconds)} s`;
      item.append(name, time); list.appendChild(item);
    });
  } catch (e) { list.innerHTML = "<li>网络不可用</li>"; }
}

/* ---------- 音效(WebAudio 合成,替代原版 SoundModule) ---------- */
let actx = null;
function beep(freq, dur, type = "sine", gain = 0.15) {
  if (!settings.sound) return;              // 原版 m_bSound
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g).connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur);
  } catch (e) { /* 无音频环境时静默 */ }
}
document.addEventListener("pointerdown", () => {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
  } catch (e) { /* 音频不可用时继续游戏 */ }
}, { once: true });
// 原版 APK 中的音效；每次创建播放实例以支持连续点击。
function playSound(name) {
  if (!settings.sound) return;
  const audio = new Audio(`/sounds/${name}.mp3`);
  audio.play().catch(() => {});
}
const sndHit = () => playSound("o");
const sndMiss = () => playSound("x");
const sndWin = () => playSound("end");

/* ---------- 工具 ---------- */
function randUnused(lo, hi) {              // 原版:循环取随机直到 UseNumber 未用
  for (;;) {
    const v = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (!used[v]) { used[v] = true; return v; }
  }
}
function fmt(t) {                          // 原版 TimeScore:秒(≤3位).百分秒(2位)
  const s = Math.floor(t), cs = Math.floor(t * 100) % 100;
  return `${s}.${String(cs).padStart(2, "0")}`;
}
function now() { return performance.now() / 1000; }
function elapsed() { return playing ? now() - timeStart : timeFrozen; }

/* ---------- 数字生成(复刻 AnswerNode.MakeQuestion) ---------- */
function makeNumber(tile) {
  if (tile.makeCount === 0)      tile.value = randUnused(1, 25);
  else if (tile.makeCount === 1) tile.value = randUnused(26, 50);
  else                           tile.value = 51;   // 空格(>50 不显示)
  tile.makeCount++;
}

function renderTile(tile) {
  tile.el.classList.toggle("empty", tile.value > TOTAL);
  tile.el.innerHTML = tile.value <= TOTAL
    ? `<span class="num">${tile.value}</span>` : "";
}

/* ---------- 问题队列(复刻 GameScene.AddQuestion) ---------- */
function addQuestion() {
  if (nextNumber > TOTAL) return;
  queue.push({ value: nextNumber++, answered: false });
}
function currentQuestion() {
  return queue.find((q) => !q.answered) || null;
}
function renderQueue() {
  const pending = queue.filter((q) => !q.answered);
  queueCurrentEl.textContent = pending.length ? pending[0].value : "50";
  queueCurrentEl.classList.remove("swap");
  void queueCurrentEl.offsetWidth;          // 重启动画
  queueCurrentEl.classList.add("swap");
  queueNextEl.innerHTML = pending.slice(1, TARGET_QUEUE_LEN)
    .map((q) => `<div class="q">${q.value}</div>`).join("");
}

/* ---------- 初始化(复刻 GameScene.InitData) ---------- */
function initGame() {
  tiles = []; used = new Array(TOTAL + 2).fill(false);
  queue = []; nextNumber = 1;
  playing = false; timeFrozen = 0; helpShown = false;
  boardEl.innerHTML = "";
  for (let i = 0; i < SIZE * SIZE; i++) {
    const el = document.createElement("div");
    el.className = "tile";
    const tile = { value: 0, makeCount: 0, el };
    makeNumber(tile);                        // 初次:1–25
    renderTile(tile);
    el.addEventListener("pointerdown", () => onTap(tile));
    boardEl.appendChild(el);
    tiles.push(tile);
  }
  for (let i = 0; i < TARGET_QUEUE_LEN; i++) addQuestion();  // 初始 5 个目标
  renderQueue();
  timerEl.textContent = fmt(0);
  bestEl.textContent = best ? fmt(best) : "--.--";
}

/* ---------- 点按(复刻 onSceneTouchEvent) ---------- */
function onTap(tile) {
  if (!playing || tile.value > TOTAL || tile.value === 0) return;
  const q = currentQuestion();
  if (!q) return;

  if (tile.value === q.value) {
    q.answered = true;
    lastHitAt = now();            // 原版:m_fHelpLightTime = 当前时间
    clearHelp();                  // 原版 ReMake:m_pLight 隐藏并清除动画
    helpShown = false;            // 原版:m_bHelpLightUse = false

    const isLast = q.value === TOTAL;
    const nt = tile.value;
    // ReMake 动画:0.65s 序列结束后换新数(对应原版第4段子序列完成时 MakeQuestion)
    tile.el.classList.add("pop");
    sndHit();
    setTimeout(() => {
      tile.el.classList.remove("pop");
      makeNumber(tile);                      // 第二轮:26–50;此后为空
      renderTile(tile);
    }, 400);

    addQuestion();
    renderQueue();
    if (isLast) { gameOver(); }
  } else {
    tile.el.classList.remove("miss");
    void tile.el.offsetWidth;
    tile.el.classList.add("miss");
    sndMiss();
    if (settings.vibration && navigator.vibrate) navigator.vibrate(80);   // 原版 m_bVibration + 80ms
  }
}

/* ---------- 帮助亮光(复刻 Tick + AnswerNode.Light):
   2s 无正确点击触发;亮光层叠加在目标格上,1s 周期呼吸(0.5s 淡入放大至1.05
   → 0.5s 淡出回 1.0),循环直到该格被点中。不外扩、不改格子实际尺寸。 ---------- */
function clearHelp() {
  document.querySelectorAll(".tile.help").forEach((t) => t.classList.remove("help"));
}
function maybeHelp() {
  if (!playing || helpShown) return;
  if (now() - lastHitAt < HELP_DELAY) return;
  const q = currentQuestion();
  if (!q) return;
  const hit = tiles.find((t) => t.value === q.value);
  if (hit) { hit.el.classList.add("help"); helpShown = true; }
}

/* ---------- 倒计时(复刻 Ready1/2/3/Start) ---------- */
async function readyCountdown() {
  overlayEl.classList.add("show");
  gameoverEl.classList.remove("show");
  for (const s of ["3", "2", "1", "GO!"]) {
    countdownEl.textContent = s;
    countdownEl.classList.remove("show");
    void countdownEl.offsetWidth;
    countdownEl.classList.add("show");
    playSound(s === "GO!" ? "go" : "ready");
    await new Promise((r) => setTimeout(r, 800));
  }
  countdownEl.classList.remove("show");
  overlayEl.classList.remove("show");
  playing = true;
  timeStart = now();
  lastHitAt = now();
}

/* ---------- 结束(复刻 GameOver:超时判负 / 通关结算) ---------- */
function gameOver(isWin = true) {
  playing = false;
  timeFrozen = now() - timeStart;
  clearHelp();
  sndWin();                       // 原版 GameOver → SoundModule.Play(6)

  if (!isWin) {
    // 原版 Tick:m_fTime > 300 → GameOver(false) → 3s 后 ChangeMainScene
    $("go-text").textContent = "TIME OVER";
    $("go-time").textContent = `${fmt(TIME_LIMIT)} s`;
    $("go-stars").innerHTML = "";
    $("go-record").textContent = "";
    $("go-rank").textContent = "";
    $("go-name-row").classList.remove("show");
    overlayEl.classList.add("show");
    countdownEl.classList.remove("show");
    gameoverEl.classList.add("show");
    setTimeout(() => {
      if (!playing && $("go-text").textContent === "TIME OVER")
        showMenu();
    }, 3000);
    return;
  }

  const isRecord = best === null || timeFrozen < best;
  if (isRecord) {
    best = timeFrozen;
    localStorage.setItem("1to50.best", String(best));
    bestEl.textContent = fmt(best);
  }

  // 清空排名提示后再提交，避免覆盖异步返回的结果。
  $("go-rank").textContent = "";
  submitScore(timeFrozen);
  setTimeout(() => {
    $("go-text").textContent = "FINISH!";
    $("go-time").textContent = `${fmt(timeFrozen)} s`;
    const stars = getStarCount(timeFrozen);          // 原版 0–10 星
    $("go-stars").innerHTML =
      "⭐".repeat(stars) + `<span class="star-num">${stars}/10</span>`;
    $("go-record").textContent = isRecord ? "新纪录!" : "";
    overlayEl.classList.add("show");
    countdownEl.classList.remove("show");
    gameoverEl.classList.add("show");
  }, 3000);
}

/* ---------- 主循环(复刻 GameScene.Tick) ---------- */
setInterval(() => {
  if (playing) {
    const t = elapsed();
    timerEl.textContent = fmt(t);
    if (t > TIME_LIMIT) { gameOver(false); return; }   // 原版:300s 判负
    maybeHelp();                                        // 原版:2s 无操作亮起目标
  }
}, 31);   // ≈1/30s,匹配百分秒显示刷新

/* ---------- 主菜单(对应原版 MainScene:先准备,点开始才倒计时) ---------- */
function showMenu() {
  playing = false;
  overlayEl.classList.remove("show");
  $("menu").classList.add("show");
  $("menu-best").textContent = best ? fmt(best) : "--.--";
  initGame();                       // 菜单背后先摆好棋盘,开始后无需等待
}

/* ---------- 入口 ---------- */
$("btn-menu-start").addEventListener("click", () => {
  $("menu").classList.remove("show");
  readyCountdown();
});
$("btn-menu").addEventListener("click", showMenu);          // 结算框"回菜单"
$("btn-restart").addEventListener("click", () => { initGame(); readyCountdown(); });
$("btn-again").addEventListener("click", () => { initGame(); readyCountdown(); });
$("btn-rank").addEventListener("click", showLeaderboard);
$("btn-menu-rank").addEventListener("click", showLeaderboard);
$("btn-rank-close").addEventListener("click", () => $("rank-modal").classList.remove("show"));

/* 设置弹窗:音效 / 震动(对应原版 DataMgr.m_bSound / m_bVibration) */
$("btn-settings").addEventListener("click", () => $("settings-modal").classList.add("show"));
$("btn-menu-settings").addEventListener("click", () => $("settings-modal").classList.add("show"));
$("btn-settings-close").addEventListener("click", () => $("settings-modal").classList.remove("show"));
function bindToggle(id, key) {
  const el = $(id);
  el.classList.toggle("on", settings[key]);
  el.addEventListener("click", () => {
    settings[key] = !settings[key];
    el.classList.toggle("on", settings[key]);
    saveSettings();
    if (key === "sound" && settings.sound) beep(880, 0.08, "triangle");  // 开启时给个反馈音
  });
}
bindToggle("toggle-sound", "sound");
bindToggle("toggle-vibration", "vibration");

showMenu();
