/* 1to50 — HTML 复刻版
 * 玩法逻辑逆向自 com.westriversw.b1to50 v3.9(见仓库 REVERSE-ENGINEERING.md):
 *  - 5×5 棋盘,初始随机铺满不重复的 1–25        (AnswerNode.MakeQuestion, m_iMakeCount==0)
 *  - 答对后格子换为 26–50 中未用的随机数        (m_iMakeCount==1,一局恰好 25格×2轮=50)
 *  - 目标队列:从 1 开始,初始 5 个,答一补一       (GameScene.AddQuestion / InitData)
 *  - 答错:Miss 闪烁 + 震动 80ms                  (onSceneTouchEvent)
 *  - 计时:向上,格式 秒.百分秒                    (TimeScore: Sec100..1 . MilliSec10..1)
 *  - 胜利:点到 50 → GameOver(true) → 3s 后结算   (GameScene.GameOver)
 * 未取证的设计选择:帮助高亮时长(5s)、星星阈值、音效(合成音)。
 */
"use strict";

const SIZE = 5, TOTAL = 50, TARGET_QUEUE_LEN = 5;
const HELP_DELAY = 5.0;          // 秒无操作后高亮目标(推断值)
const STAR_3 = 15, STAR_2 = 25;  // 星星阈值秒(推断值)

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
let lastHitAt = 0, helpShown = false;
let best = parseFloat(localStorage.getItem("1to50.best")) || null;

/* ---------- 云端排行(原版 RankWorldLayer;本地 best 对应 RankLocalLayer) ---------- */
const clientId =
  localStorage.getItem("1to50.clientId") ||
  localStorage.setItem("1to50.clientId", crypto.randomUUID()) ||
  localStorage.getItem("1to50.clientId");

async function submitScore(timeSeconds) {
  let name = localStorage.getItem("1to50.name");
  if (!name) {
    name = (prompt("上榜昵称(最多16字):", "匿名玩家") || "匿名玩家").slice(0, 16);
    localStorage.setItem("1to50.name", name);
  }
  try {
    const r = await fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, playerName: name, timeSeconds }),
    });
    const d = await r.json();
    if (d.ok) $("go-rank").textContent = `世界排名 #${d.rank}`;
  } catch (e) { /* 离线时静默,本地记录仍有效 */ }
}

async function showLeaderboard() {
  const modal = $("rank-modal"), list = $("rank-list");
  modal.classList.add("show");
  list.innerHTML = "<li>加载中…</li>";
  try {
    const d = await (await fetch("/api/leaderboard")).json();
    list.innerHTML = d.ok && d.entries.length
      ? d.entries.map((e) => `<li><span class="rn">${e.playerName}</span><span class="rt">${fmt(e.timeSeconds)} s</span></li>`).join("")
      : "<li>还没有人通关,来当第一个!</li>";
  } catch (e) { list.innerHTML = "<li>网络不可用</li>"; }
}

/* ---------- 音效(WebAudio 合成,替代原版 SoundModule) ---------- */
let actx = null;
function beep(freq, dur, type = "sine", gain = 0.15) {
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
const sndHit  = () => beep(880, 0.09, "triangle");       // 原版 Play(1)
const sndMiss = () => beep(160, 0.15, "square", 0.08);
const sndWin  = () => { beep(660, .12); setTimeout(()=>beep(880,.12),140); setTimeout(()=>beep(1100,.25),300); }; // 原版 Play(6)

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
    lastHitAt = now(); helpShown = false;
    clearHelp();

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
    if (isLast) { setTimeout(gameOver, 450); }
  } else {
    tile.el.classList.remove("miss");
    void tile.el.offsetWidth;
    tile.el.classList.add("miss");
    sndMiss();
    if (navigator.vibrate) navigator.vibrate(80);   // 原版 vibrate(80ms)
  }
}

/* ---------- 帮助高亮(推断行为) ---------- */
function clearHelp() {
  document.querySelectorAll(".tile.help").forEach((t) => t.classList.remove("help"));
}
function maybeHelp() {
  if (!playing || helpShown || !queue.length) return;
  if (now() - lastHitAt < HELP_DELAY) return;
  const q = currentQuestion();
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
    beep(s === "GO!" ? 990 : 660, 0.1, "triangle");
    await new Promise((r) => setTimeout(r, 800));
  }
  countdownEl.classList.remove("show");
  overlayEl.classList.remove("show");
  playing = true;
  timeStart = now();
  lastHitAt = now();
}

/* ---------- 结束(复刻 GameOver(true):淡入 → 3s 后结算) ---------- */
function gameOver() {
  playing = false;
  timeFrozen = now() - timeStart;
  sndWin();
  clearHelp();

  const isRecord = best === null || timeFrozen < best;
  if (isRecord) {
    best = timeFrozen;
    localStorage.setItem("1to50.best", String(best));
    bestEl.textContent = fmt(best);
  }

  // 3 秒后弹结算框(对应原版 DelayModifier(3.0f));同时提交世界排行
  submitScore(timeFrozen);
  setTimeout(() => {
    $("go-text").textContent = "FINISH!";
    $("go-time").textContent = `${fmt(timeFrozen)} s`;
    const stars = timeFrozen < STAR_3 ? 3 : timeFrozen < STAR_2 ? 2 : 1;
    $("go-stars").innerHTML =
      (isRecord ? `<span class="star">⭐</span>`.repeat(stars) : "⭐".repeat(stars));
    $("go-record").textContent = isRecord ? "新纪录!" : "";
    $("go-rank").textContent = "";
    overlayEl.classList.add("show");
    countdownEl.classList.remove("show");
    gameoverEl.classList.add("show");
  }, 3000);
}

/* ---------- 主循环 ---------- */
setInterval(() => {
  if (playing) {
    timerEl.textContent = fmt(elapsed());
    maybeHelp();
  }
}, 31);   // ≈1/30s,匹配百分秒显示刷新

/* ---------- 入口 ---------- */
$("btn-restart").addEventListener("click", () => { initGame(); readyCountdown(); });
$("btn-again").addEventListener("click", () => { initGame(); readyCountdown(); });
$("btn-rank").addEventListener("click", showLeaderboard);
$("btn-rank-close").addEventListener("click", () => $("rank-modal").classList.remove("show"));

initGame();
readyCountdown();
