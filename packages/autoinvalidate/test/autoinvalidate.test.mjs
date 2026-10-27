import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  createAutoInvalidatePg,
  RedisCacheStore,
  MemoryCacheStore,
  analyzeSql
} from '../dist/index.mjs';

const require = createRequire(import.meta.url);
const cjsModule = require('../dist/index.cjs');

/**
 * Creates a mock `pg.Pool` that tracks SQL executions and simulates PostgreSQL responses.
 */
function createMockPgPool() {
  const executedQueries = [];
  let userName = 'Husnain';

  const pool = {
    executedQueries,
    async query(queryTextOrConfig, values) {
      const text = typeof queryTextOrConfig === 'object' ? queryTextOrConfig.text : queryTextOrConfig;
      const params = typeof queryTextOrConfig === 'object' ? queryTextOrConfig.values : values;
      executedQueries.push({ text, params });

      if (/^SELECT/i.test(text.trim())) {
        return {
          rows: [{ id: params?.[0] ?? 1, name: userName, role: 'admin' }],
          rowCount: 1,
          command: 'SELECT',
          oid: 0,
          fields: []
        };
      }

      if (/^UPDATE/i.test(text.trim())) {
        userName = params?.[0] ?? 'Updated User';
        return { rows: [], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] };
      }

      return { rows: [], rowCount: 1, command: 'OK', oid: 0, fields: [] };
    },
    async connect() {
      return {
        query: pool.query.bind(pool),
        release() {}
      };
    }
  };

  return pool;
}

/**
 * Creates an in-memory mock `ioredis` client to test `RedisCacheStore` Set-based tag indexing.
 */
function createMockIoRedis() {
  const kv = new Map();
  const sets = new Map();

  return {
    kv,
    sets,
    async get(key) {
      return kv.get(key) ?? null;
    },
    async set(key, value) {
      kv.set(key, value);
      return 'OK';
    },
    async sadd(key, member) {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key).add(member);
      return 1;
    },
    async smembers(key) {
      return sets.has(key) ? Array.from(sets.get(key)) : [];
    },
    async pexpire() {
      return 1;
    },
    async del(...keys) {
      let count = 0;
      for (const k of keys.flat()) {
        if (kv.delete(k)) count++;
        if (sets.delete(k)) count++;
      }
      return count;
    }
  };
}

describe('autoinvalidate — SQL Analyzer & Tag Extractor', () => {
  it('extracts tables and row-level ID tags from SELECT + JOIN queries', () => {
    const res = analyzeSql(
      `SELECT u.id, u.email, o.total
       FROM public.users u
       INNER JOIN orders o ON o.user_id = u.id
       WHERE u.id = $1 AND o.status = 'paid'`,
      [42]
    );

    assert.equal(res.operation, 'SELECT');
    assert.equal(res.isCacheableRead, true);
    assert.deepEqual(res.tables.sort(), ['orders', 'users']);
    assert.ok(res.allTags.includes('table:users'));
    assert.ok(res.allTags.includes('table:orders'));
    assert.ok(res.allTags.includes('table:users:id:42'));
  });

  it('ignores CTE alias names and extracts real underlying tables', () => {
    const res = analyzeSql(`
      WITH recent_orders AS (
        SELECT * FROM orders WHERE created_at > '2026-01-01'
      )
      SELECT u.name, r.total
      FROM users u
      JOIN recent_orders r ON r.user_id = u.id
    `);

    assert.equal(res.operation, 'SELECT');
    assert.deepEqual(res.tables.sort(), ['orders', 'users']);
    assert.ok(!res.tables.includes('recent_orders'));
  });

  it('skips caching volatile SQL queries automatically', () => {
    const volatileNow = analyzeSql('SELECT * FROM sessions WHERE expires_at > NOW()');
    assert.equal(volatileNow.hasVolatileFunctions, true);
    assert.equal(volatileNow.isCacheableRead, false);

    const lockingForUpdate = analyzeSql('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [10]);
    assert.equal(lockingForUpdate.hasVolatileFunctions, true);
    assert.equal(lockingForUpdate.isCacheableRead, false);
  });
});

describe('autoinvalidate — PostgreSQL Auto-Caching & Write Invalidation', () => {
  it('caches SELECT queries and automatically invalidates when target table is mutated', async () => {
    const rawPool = createMockPgPool();
    const db = createAutoInvalidatePg(rawPool, { defaultTtlMs: 30_000 });

    // 1. First SELECT -> Cache Miss (hits Postgres)
    const first = await db.query('SELECT * FROM users WHERE id = $1', [7]);
    assert.equal(first._cache.hit, false);
    assert.equal(first.rows[0].name, 'Husnain');
    assert.equal(rawPool.executedQueries.length, 1);

    // 2. Second SELECT -> Cache Hit (served from cache without hitting Postgres)
    const second = await db.query('SELECT * FROM users WHERE id = $1', [7]);
    assert.equal(second._cache.hit, true);
    assert.equal(second.rows[0].name, 'Husnain');
    assert.equal(rawPool.executedQueries.length, 1);

    // 3. UPDATE users -> Automatically invalidates `table:users`
    await db.query('UPDATE users SET name = $1 WHERE id = $2', ['Husnain Pro', 7]);
    assert.equal(rawPool.executedQueries.length, 2);

    // 4. Next SELECT -> Cache Miss with fresh data from Postgres!
    const third = await db.query('SELECT * FROM users WHERE id = $1', [7]);
    assert.equal(third._cache.hit, false);
    assert.equal(third.rows[0].name, 'Husnain Pro');
    assert.equal(rawPool.executedQueries.length, 3);

    const stats = db.getStats();
    assert.equal(stats.hits, 1);
    assert.equal(stats.misses, 2);
    assert.equal(stats.invalidations, 1);
  });

  it('automatically invalidates JOINed queries when any joined table is mutated', async () => {
    const rawPool = createMockPgPool();
    const db = createAutoInvalidatePg(rawPool);

    const sql = 'SELECT u.name, o.id FROM users u JOIN orders o ON o.user_id = u.id WHERE u.id = $1';

    await db.query(sql, [1]);
    const cachedJoin = await db.query(sql, [1]);
    assert.equal(cachedJoin._cache.hit, true);

    // Mutate `orders` table -> should invalidate the `users JOIN orders` cached query!
    await db.query('INSERT INTO orders (user_id, total) VALUES ($1, $2)', [1, 99]);

    const afterOrderInsert = await db.query(sql, [1]);
    assert.equal(afterOrderInsert._cache.hit, false);
  });

  it('prevents cache stampedes via Singleflight request coalescing', async () => {
    let dbCallCount = 0;
    const slowPool = {
      async query() {
        dbCallCount++;
        await new Promise((r) => setTimeout(r, 25));
        return { rows: [{ ok: true }], rowCount: 1, command: 'SELECT', oid: 0, fields: [] };
      }
    };

    const db = createAutoInvalidatePg(slowPool, { singleflight: true });

    // Fire 10 identical concurrent requests simultaneously
    const results = await Promise.all(
      Array.from({ length: 10 }, () => db.query('SELECT * FROM products WHERE featured = true'))
    );

    assert.equal(dbCallCount, 1, 'Expected only 1 SQL query to hit PostgreSQL during stampede');
    assert.equal(results.length, 10);
    assert.equal(db.getStats().coalescedRequests, 9);
  });

  it('buffers invalidations inside transactions until COMMIT and discards on ROLLBACK', async () => {
    const rawPool = createMockPgPool();
    const db = createAutoInvalidatePg(rawPool);

    await db.query('SELECT * FROM users WHERE id = $1', [1]);

    // 1. Transaction that rolls back should NOT evict cache
    const client1 = await db.connect();
    await client1.query('BEGIN');
    await client1.query('DELETE FROM users WHERE id = $1', [1]);
    await client1.query('ROLLBACK');

    const stillCached = await db.query('SELECT * FROM users WHERE id = $1', [1]);
    assert.equal(stillCached._cache.hit, true);

    // 2. Transaction that commits SHOULD evict cache on COMMIT
    const client2 = await db.connect();
    await client2.query('BEGIN');
    await client2.query('UPDATE users SET name = $1 WHERE id = $2', ['Committed Name', 1]);
    await client2.query('COMMIT');

    const afterCommit = await db.query('SELECT * FROM users WHERE id = $1', [1]);
    assert.equal(afterCommit._cache.hit, false);
  });

  it('works with RedisCacheStore (ioredis / node-redis Set tag indexing)', async () => {
    const mockRedis = createMockIoRedis();
    const redisStore = new RedisCacheStore(mockRedis);
    const rawPool = createMockPgPool();
    const db = createAutoInvalidatePg(rawPool, { store: redisStore });

    const r1 = await db.query('SELECT * FROM users WHERE id = $1', [99]);
    assert.equal(r1._cache.hit, false);
    assert.ok(mockRedis.sets.has('ai:tag:table:users'));

    const r2 = await db.query('SELECT * FROM users WHERE id = $1', [99]);
    assert.equal(r2._cache.hit, true);

    await db.query('DELETE FROM users WHERE id = $1', [99]);
    assert.equal(mockRedis.sets.has('ai:tag:table:users'), false);

    const r3 = await db.query('SELECT * FROM users WHERE id = $1', [99]);
    assert.equal(r3._cache.hit, false);
  });

  it('exports both ESM and CommonJS modules cleanly', () => {
    assert.equal(typeof cjsModule.createAutoInvalidatePg, 'function');
    assert.equal(typeof cjsModule.RedisCacheStore, 'function');
    assert.equal(typeof cjsModule.MemoryCacheStore, 'function');
  });
});

