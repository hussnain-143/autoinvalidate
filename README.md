<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/hussnain-143/autoinvalidate/main/branding/logos/logo-full-dark.svg">
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/hussnain-143/autoinvalidate/main/branding/logos/logo-full-light.svg">
  <img alt="autoinvalidate logo" src="https://raw.githubusercontent.com/hussnain-143/autoinvalidate/main/branding/logos/logo-full-dark.svg" width="480">
</picture>

### Zero-Config PostgreSQL (`pg`) & Redis Query Cache with Automatic Write Invalidation

[![npm version](https://img.shields.io/npm/v/autoinvalidate.svg?style=flat-square&color=FF4438)](https://www.npmjs.com/package/autoinvalidate)
[![GitHub Repository](https://img.shields.io/badge/GitHub-hussnain--143%2Fautoinvalidate-181717?style=flat-square&logo=github)](https://github.com/hussnain-143/autoinvalidate)
[![Tests](https://img.shields.io/badge/Tests-Passing%20(9%2F9)-10b981?style=flat-square)](https://github.com/hussnain-143/autoinvalidate)
[![Default Store](https://img.shields.io/badge/Store-In--Memory%20LRU%20(Default)-10b981?style=flat-square)](#)
[![Redis Optional](https://img.shields.io/badge/Distributed-Redis%20Ready-336791?style=flat-square)](https://redis.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178c6?style=flat-square)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-f59e0b?style=flat-square)](./LICENSE)

<p align="center">
  <a href="#-quickstart">Quickstart</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-how-it-works">How It Works</a> •
  <a href="#-distributed-mode-redis">Redis Mode</a> •
  <a href="#-transactions">Transactions</a> •
  <a href="#-telemetry">Telemetry</a> •
  <a href="#-repository-structure">Structure</a>
</p>

</div>

---

> *"There are only two hard things in Computer Science: cache invalidation and naming things."* — Phil Karlton

**`autoinvalidate`** solves the hardest part of backend caching for Node.js and PostgreSQL applications. Wrap your existing `pg.Pool` or `pg.Client` once: every `SELECT` query is automatically cached in memory (or Redis), tagged by its referenced SQL tables and row IDs, and **automatically invalidated** whenever an `INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE` mutates those tables.

Stop writing error-prone manual `redis.del()` calls across your controllers and services.

---

## ✨ Key Features

- ⚡ **Zero-Config In-Memory by Default:** Works out-of-the-box with **zero external services or Redis setup**. Wrap your pool and start caching immediately with sub-millisecond lookups.
- 🚀 **Seamless Distributed Redis Upgrade:** Swap to Redis Sets (`SADD` / `SMEMBERS` / `DEL`) for multi-container clusters in one line of configuration.
- 🧠 **Automatic SQL AST Table & Row Tagging:** Parses `SELECT`, `JOIN`s, `WITH` CTEs, `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` queries automatically—no manual cache keys required.
- 🛡️ **Singleflight Stampede Protection:** If 500 concurrent requests hit an uncached query at the exact same millisecond, only **1** query hits the database while all 500 share the result.
- 🔒 **Transaction-Aware (`BEGIN` / `COMMIT` / `ROLLBACK`):** Buffers invalidation tags during transactions and flushes on `COMMIT` (or safely discards on `ROLLBACK`).
- 🛟 **Fail-Open Resilience:** If an external cache store is unreachable, queries transparently fall back directly to PostgreSQL without downtime.
- 📊 **Real-time Telemetry:** Built-in hit/miss rates, invalidation counters, and latency measurements for production observability.

---

## 🏗️ How It Works

```
                       ┌───────────────────────────────┐
                       │     Your Application Code     │
                       │     (db.query('SELECT ...')   │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │     autoinvalidate Proxy      │
                       │   (Transparent pg.Pool wrap)  │
                       └───────────────┬───────────────┘
                                       │
            ┌──────────────────────────┴──────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────┐                           ┌─────────────────────┐
│    SQL AST Analyzer      │                           │ Singleflight Engine │
│ Extracts tables and row  │                           │ Coalesces identical │
│ tags (e.g. table:users)  │                           │ concurrent queries  │
└───────────┬──────────────┘                           └──────────┬──────────┘
            │                                                     │
            ├──────────────────────────┬──────────────────────────┘
            ▼                          ▼
┌──────────────────────────┐ ┌───────────────────────────────────┐
│ Cache Store Hit / Miss   │ │ PostgreSQL Database               │
│ • In-Memory LRU (0 deps) │ │ Executes query on cache miss      │
│ • Redis Sets (SADD/SMEM) │ │ Executes mutations (INSERT/UPDATE)│
└──────────────────────────┘ └───────────────────────────────────┘
```

When a mutation runs (`INSERT`, `UPDATE`, `DELETE`, or `TRUNCATE`):
1. `autoinvalidate` extracts the affected target tables from the SQL AST.
2. It queries the tag index for all cached query keys referencing those tables.
3. It purges the invalidated entries atomically across all server instances.

---

## 📦 Installation

```bash
# ⚡ Default (Zero external dependencies needed!)
npm install autoinvalidate pg

# 🚀 Optional: Distributed Redis for multi-server clusters
npm install autoinvalidate pg ioredis
```

---

## 🚀 Quickstart

### 1. Zero-Config In-Memory Mode (No Redis Needed)

```typescript
import { Pool } from 'pg';
import autoinvalidate from 'autoinvalidate';

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ⚡ Wrap your pool: high-speed LRU memory store is active by default
export const db = autoinvalidate(rawPool);

// 1️⃣ First query -> Cache MISS (Queries PostgreSQL, caches under `table:users` & `table:orders`)
const res1 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
console.log(res1._cache); // { hit: false, latencyMs: 14.2, tags: ['table:users', 'table:orders', 'table:users:id:42'] }

// 2️⃣ Second query -> Cache HIT (< 0.1ms from in-memory cache, 0 PostgreSQL load!)
const res2 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
console.log(res2._cache); // { hit: true, latencyMs: 0.08, tags: [...] }

// 3️⃣ Mutate `orders` -> Automatically invalidates all cached queries touching `orders`!
await db.query(`UPDATE orders SET total = $1 WHERE user_id = $2`, [199.99, 42]);

// 4️⃣ Next query -> Fresh data fetched from PostgreSQL and re-cached!
const res3 = await db.query(
  `SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1`,
  [42]
);
console.log(res3._cache.hit); // false (refreshed!)
```

---

## 🌐 Distributed Mode (Redis / Upstash)

When scaling across multiple server instances or containers, pass `store: new RedisCacheStore(redis)`:

```typescript
import { Pool } from 'pg';
import Redis from 'ioredis';
import autoinvalidate, { RedisCacheStore } from 'autoinvalidate';

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

// 🚀 Distributed across all containers via atomic Redis Sets:
export const db = autoinvalidate(rawPool, {
  store: new RedisCacheStore(redis),
  defaultTtlMs: 60_000, // 60 seconds TTL
  singleflight: true
});
```

---

## 🔄 Transactions (`BEGIN` / `COMMIT` / `ROLLBACK`)

When using checked-out clients via `await db.connect()`, `autoinvalidate` tracks transaction boundaries automatically:

```typescript
const client = await db.connect();
try {
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - 100 WHERE id = $1', [1]);
  await client.query('UPDATE accounts SET balance = balance + 100 WHERE id = $1', [2]);

  // Invalidation for `table:accounts` is triggered atomically upon COMMIT:
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

## ⚙️ Per-Query Cache Controls

You can customize TTL, add custom domain tags, or bypass caching for specific queries:

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

// Bypass cache for real-time reads
await db.query(
  'SELECT balance FROM wallets WHERE user_id = $1',
  [42],
  { cache: false }
);
```

---

## 📊 Telemetry & Observability

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
  avgHitLatencyMs: 0.12,
  avgMissLatencyMs: 14.85
}
*/
```

---

## 📂 Repository Structure

```text
autoinvalidate/
├── packages/
│   └── autoinvalidate/               # 📦 Production NPM Package
│       ├── src/
│       │   ├── sql-analyzer.ts       # SQL AST table & row-tag parser
│       │   ├── pg-adapter.ts         # pg.Pool/Client proxy & Singleflight engine
│       │   ├── stores/redis.ts       # O(1) Redis Set tag store
│       │   ├── stores/memory.ts      # Zero-dep LRU in-memory store
│       │   ├── types.ts              # Strict TypeScript definitions
│       │   └── index.ts              # Public package exports
│       ├── test/
│       │   └── autoinvalidate.test.mjs # 9 automated tests
│       ├── dist/                     # ESM (.mjs), CJS (.cjs), Types (.d.ts)
│       └── package.json
│
├── branding/                         # 🎨 Brand Assets & Launch Kit
│   ├── BRAND_AND_LAUNCH_KIT.md       # Product Hunt, Reddit & Launch Kit
│   └── logos/                        # Official SVGs & Badges
│
├── LICENSE                           # MIT License
├── package.json                      # Monorepo configuration
└── tsconfig.base.json
```

---

## 🛠️ Development & Testing

```bash
# Install dependencies
npm install

# Run the automated test suite
npm test

# Build the NPM package (ESM + CommonJS + Types)
npm run build:pkg
```

---

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!  
Feel free to check out the [issues page](https://github.com/hussnain-143/autoinvalidate/issues).

---

## 📄 License

Distributed under the MIT License. See [LICENSE](./LICENSE) for details.

Developed with ❤️ by **[Hussnain Ahmed](https://github.com/hussnain-143)**.
