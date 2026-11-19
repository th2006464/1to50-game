import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;

test('leaderboard defaults to top 50 and today applies a UTC+8 date filter', async () => {
  const queries = [];
  const env = { DB: { prepare(sql) { queries.push(sql); return { all: async () => ({ results: [] }) }; } } };
  for (const suffix of ['', '?period=today']) {
    const response = await worker.fetch(new Request(`https://example.com/api/leaderboard${suffix}`), env);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).entries, []);
  }
  assert.match(queries[0], /LIMIT\s+50/i);
  assert.doesNotMatch(queries[0], /WHERE/i);
  assert.match(queries[1], /recorded_at\s*>=/i);
  assert.match(queries[1], /\+8 hours/i);
  assert.match(queries[1], /-8 hours/i);
});
