// 1to50 Worker — API 路由 + 静态资源回落
// 排行榜对应原版 RankWorldLayer(D1 云端);本地最佳对应 RankLocalLayer(localStorage)。
const json = (data, init = {}) => Response.json(data, {
  ...init,
  headers: { 'Cache-Control': 'no-store', ...(init.headers || {}) },
});

const cleanName = value => String(value || '匿名玩家').trim().slice(0, 16) || '匿名玩家';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9-]{8,80}$/.test(value);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/api/health') {
        return json({ ok: true, service: '1to50-game' });
      }

      // 世界排行榜:最快的 50 条(1to50 比的是用时,越短越好)
      if (url.pathname === '/api/leaderboard' && request.method === 'GET') {
        const { results } = await env.DB.prepare(`
          SELECT id AS recordId, player_name AS playerName, time_seconds AS timeSeconds,
                 recorded_at AS recordedAt
          FROM one_to_fifty_scores
          ${url.searchParams.get("period") === "today" ? "WHERE recorded_at >= datetime('now', '+8 hours', 'start of day', '-8 hours') AND recorded_at < datetime('now', '+8 hours', 'start of day', '+1 day', '-8 hours')" : ""}
          ORDER BY time_seconds ASC, recorded_at ASC
          LIMIT 50
        `).all();
        return json({ ok: true, entries: results });
      }

      // 提交成绩,返回当前世界排名
      if (url.pathname === '/api/score' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body || !validId(body.clientId))
          return json({ ok: false, error: 'invalid clientId' }, { status: 400 });
        const t = Number(body.timeSeconds);
        if (!Number.isFinite(t) || t < 1 || t > 3600)
          return json({ ok: false, error: 'invalid timeSeconds' }, { status: 400 });

        await env.DB.prepare(`
          INSERT INTO one_to_fifty_scores (client_id, player_name, time_seconds) VALUES (?, ?, ?)
        `).bind(body.clientId, cleanName(body.playerName), t).run();

        const { count } = await env.DB.prepare(`
          SELECT COUNT(*) AS count FROM one_to_fifty_scores WHERE time_seconds < ?
        `).bind(t).first();
        return json({ ok: true, rank: count + 1 });
      }

      // 其余请求回落到 public/ 静态资源
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ ok: false, error: 'internal' }, { status: 500 });
    }
  },
};
