<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/hussnain-143/autoinvalidate/main/branding/logos/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/hussnain-143/autoinvalidate/main/branding/logos/logo-full-light.svg">
  <img alt="autoinvalidate logo" src="https://raw.githubusercontent.com/hussnain-143/autoinvalidate/main/branding/logos/logo-full-dark.svg" width="480">
</picture>

### Zero-Config PostgreSQL (`pg`) & Redis Query Cache with Automatic Write Invalidation

[![npm version](https://img.shields.io/npm/v/autoinvalidate.svg?style=flat-square&color=FF4438)](https://www.npmjs.com/package/autoinvalidate)
[![GitHub Repository](https://img.shields.io/badge/GitHub-hussnain--143%2Fautoinvalidate-181717?style=flat-square&logo=github)](https://github.com/hussnain-143/autoinvalidate)
[![Default In-Memory](https://img.shields.io/badge/Store-In--Memory%20(Default)-10b981?style=flat-square)](#)
[![Redis Optional](https://img.shields.io/badge/Distributed-Redis%20Ready-336791?style=flat-square)](https://redis.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](https://github.com/hussnain-143/autoinvalidate/blob/main/LICENSE)

</div>

---

> **The zero-config database query cache that automatically invalidates cached queries on every write. Built-in In-Memory LRU by default, seamlessly scalable to distributed Redis.**

> *"There are only two hard things in Computer Science: cache invalidation and naming things."* — Phil Karlton

**`autoinvalidate`** solves the hardest part of backend caching for Node.js & PostgreSQL applications. Wrap your `pg.Pool` or `pg.Client` once: every `SELECT` query is automatically cached in-process (or in Redis), tagged by its referenced SQL tables and row IDs, and **instantly invalidated** whenever an `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` mutates those tables.

---

## ✨ Highlights

- ⚡ **Zero-Config In-Memory by Default:** Works out-of-the-box with **zero external services or Redis setup**. Just wrap your pool and go.
- 🚀 **Seamless Distributed Redis Upgrade:** Swap to Redis Sets (`SADD` / `SMEMBERS` / `DEL`) for multi-container deployments in one line of configuration.
- 🧠 **Automatic SQL AST Table & Row Tagging:** Parses `SELECT`, `JOIN`s, `WITH` CTEs, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` queries automatically—no manual cache keys required.
- 🛡️ **Singleflight Stampede Protection:** If 500 concurrent requests hit an uncached query at the exact same millisecond, only **1** query hits the database while all 500 share the result.
- 🔒 **Transaction-Aware (`BEGIN` / `COMMIT` / `ROLLBACK`):** Buffers invalidation tags during transactions and flushes on `COMMIT` (or discards on `ROLLBACK`).
- 🛟 **Fail-Open Resilience:** If an external store is ever unreachable, queries transparently route directly to the database.

---

## 📦 Installation

```bash
# Default (Zero external dependencies needed!)
npm install autoinvalidate pg

# Optional: Add Redis for distributed multi-server clusters
npm install autoinvalidate pg ioredis
```

---

## 🚀 1. Default Quickstart (Zero-Config In-Memory — 0 Redis Needed!)

```typescript
import { Pool } from 'pg';
import autoinvalidate from 'autoinvalidate';

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ⚡ Works immediately with built-in high-speed LRU memory store!
export const db = autoinvalidate(rawPool);

// 1️⃣ First SELECT -> Cache MISS (Queries PostgreSQL, caches in-memory under `table:users` & `table:orders`)
const res1 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
console.log(res1._cache); // { hit: false, latencyMs: 18.4, tags: ['table:users', 'table:orders', 'table:users:id:42'] }

// 2️⃣ Second SELECT -> Cache HIT (< 0.1ms from in-memory cache, 0 PostgreSQL load!)
const res2 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
console.log(res2._cache); // { hit: true, latencyMs: 0.11, tags: [...] }

// 3️⃣ Mutate `orders` -> Automatically invalidates all cached queries touching `orders`!
await db.query(`UPDATE orders SET total = $1 WHERE user_id = $2`, [199.99, 42]);

// 4️⃣ Next SELECT -> Fresh data fetched from PostgreSQL and re-cached!
const res3 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
```

---

## 🌐 2. Distributed Mode (Scale with Redis / Upstash)

When your application grows and you run multiple server containers, pass `store: new RedisCacheStore(redis)`:

```typescript
import { Pool } from 'pg';
import Redis from 'ioredis';
import autoinvalidate, { RedisCacheStore } from 'autoinvalidate';

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

// 🚀 Distributed across all containers via atomic Redis Sets:
export const db = autoinvalidate(rawPool, {
  store: new RedisCacheStore(redis),
  defaultTtlMs: 60_000, // 60s TTL
  singleflight: true
});
```
  [42]
);
console.log(res1._cache); // { hit: false, latencyMs: 18.4, tags: ['table:users', 'table:orders', 'table:users:id:42'] }

// 2️⃣ Second SELECT -> Cache HIT (< 0.5ms from Redis, 0 PostgreSQL load!)
const res2 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
console.log(res2._cache); // { hit: true, latencyMs: 0.4, tags: [...] }

// 3️⃣ Mutate `orders` (or `users`) -> Automatically invalidates all cached queries touching `orders`!
await db.query(`UPDATE orders SET total = $1 WHERE user_id = $2`, [199.99, 42]);

// 4️⃣ Next SELECT -> Fresh data fetched from PostgreSQL and re-cached!
const res3 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
```

---

## ⚙️ Per-Query Cache Controls

Pass a third argument (or a `cache` property on a `pg` query config object) to customize TTL, add custom business tags, or bypass the cache for a specific query:

```typescript
// Custom TTL & custom domain tags
await db.query(
  'SELECT * FROM products WHERE organization_id = $1',
  ['org_99'],
  {
    ttlMs: 300_000, // 5 minutes
    tags: ['org:org_99', 'catalog:featured']
  }
);

// Bypass cache for a real-time financial read
await db.query(
  'SELECT balance FROM wallets WHERE user_id = $1',
  [42],
  { cache: false }
);
```

---

## 🔄 Transaction Support (`BEGIN` / `COMMIT` / `ROLLBACK`)

When using checked-out clients via `await db.connect()`, `autoinvalidate` tracks transaction boundaries automatically:

```typescript
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - 100 WHERE id = $1', [1]);
  await client.query('UPDATE accounts SET balance = balance + 100 WHERE id = $1', [2]);
  // Cache for `table:accounts` is invalidated atomically upon COMMIT:
  await client.query('COMMIT');
} catch (err) {
  // If ROLLBACK occurs, queued invalidations are discarded!
  await client.query('ROLLBACK');
  throw err;
} finally {
  client.release();
}
```

---

## 📊 Live Telemetry & Observability Hooks

```typescript
const stats = db.getStats();
console.log(stats);
/*
{
  hits: 1420,
  misses: 85,
  invalidations: 19,
  invalidatedKeys: 44,
  bypasses: 12,
  coalescedRequests: 310,
  errors: 0,
  hitRate: 94.35,
  avgHitLatencyMs: 0.42,
  avgMissLatencyMs: 14.85
}
*/
```

---

## 📄 License

MIT © [Hussnain Ahmed](https://github.com/hussnain-143)

