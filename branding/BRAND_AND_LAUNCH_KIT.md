# 🚀 `autoinvalidate` — Official Brand System, PRD & Go-To-Market Launch Kit

**Product Name:** `autoinvalidate`  
**Tagline:** *Zero-Config PostgreSQL + Redis Query Cache with Automatic Write Invalidation.*  
**One-Line Pitch:** Wrap your `node-postgres` (`pg`) pool once—every `SELECT` is cached in Redis and automatically invalidated when `INSERT`, `UPDATE`, or `DELETE` mutates the underlying tables.

---

## 1. Visual Brand Identity & Design Tokens (Redis Crimson × Postgres Cobalt)

### Brand Concept
`autoinvalidate` bridges the world's most loved relational database (**PostgreSQL**) with the world's fastest in-memory cache (**Redis**). Rather than generic tech blues, the brand identity fuses **Redis Crimson (`#FF4438`)** and **Postgres Cobalt (`#336791` / `#3B82F6`)** over a rich **Warm Obsidian (`#0C0A09`)** foundation—With a high-voltage ivory lightning bolt cutting between an isometric Redis cube stack (left) and a PostgreSQL cylinder stack (right).

### Color Palette
| Token | Role | Hex | Light/Dark Adaptation |
| :--- | :--- | :---: | :--- |
| **Redis Crimson** | Primary Brand Accent & Invalidation Pulse | `#FF4438` (Dark) / `#D92D20` (Light) | `--brand-crimson` |
| **Postgres Cobalt** | Database Authority & Read Engine | `#336791` / `#60A5FA` (Dark) / `#2563EB` (Light) | `--brand-cobalt` |
| **Warm Obsidian** | Dark Mode Canvas & Code Surfaces | `#0C0A09` / `#14110F` | `--bg-canvas-dark` |
| **Warm Ivory** | Light Mode Canvas & Primary Dark Text | `#FAF8F5` | `--bg-canvas-light` |
| **Signal Emerald** | Sub-millisecond Cache Hit Indicator | `#10B981` | Paired with `✓` icon |
| **Bypass Amber** | Volatile SQL Bypass Indicator | `#F59E0B` | Paired with `⏭️` icon |

### Complete 6-Piece Vector Logo Suite (`/branding/logos/` & `/apps/web/public/brand/`)
- [`logo-mark.svg`](./logos/logo-mark.svg) — `128×128` Master App Icon (Interlocked Redis Crimson Prism + Postgres Cobalt Cylinder + Dual Sync Ring + Bolt).
- [`logo-full-dark.svg`](./logos/logo-full-dark.svg) — `560×128` Horizontal Lockup on Warm Obsidian (`#0C0A09`) for dark READMEs & headers.
- [`logo-full-light.svg`](./logos/logo-full-light.svg) — `560×128` Horizontal Lockup on Warm Ivory (`#FAF8F5`) for light docs & whitepapers.
- [`logo-badge.svg`](./logos/logo-badge.svg) — `290×44` Embeddable `autoinvalidate PG × Redis` pill badge for GitHub repositories.
- [`favicon.svg`](./logos/favicon.svg) — `64×64` High-contrast simplified vector icon for browser tabs.
- [`og-banner.svg`](./logos/og-banner.svg) — `1200×630` OpenGraph & Product Hunt social preview card.

---

## 2. Product Hunt Launch Kit (Copy & Paste Ready)

### Product Hunt Listing Fields
- **Name:** `autoinvalidate`
- **Tagline (60 chars max):** Zero-config Postgres + Redis cache that auto-invalidates
- **Topics:** Developer Tools, Open Source, Database, Node.js, PostgreSQL
- **Short Description:**
  Stop writing brittle `redis.del()` calls after every SQL `UPDATE`. `autoinvalidate` wraps `node-postgres` (`pg`) with an intelligent SQL analyzer, Redis Set tag indexing, singleflight stampede protection, and transaction-aware write invalidation.

### Maker's First Comment (Post immediately upon going live)
> Hey Product Hunt! 👋
>
> Every time I built a PERN / Node.js backend with PostgreSQL and Redis, the story was the same:
> 1. Adding Redis caching to slow `SELECT` queries took 10 minutes.
> 2. Keeping that cache fresh when `users` or `orders` updated took **weeks of debugging stale data bugs**—especially when queries had `JOIN`s!
>
> So I built **`autoinvalidate`** (`npm i autoinvalidate`), a zero-dependency TypeScript wrapper for `pg` and Redis (`ioredis` / `node-redis`).
>
> **How it works under the hood:**
> - 🧠 **SQL Table & Row Tag Extraction:** When you run `SELECT u.name, o.total FROM users u JOIN orders o ... WHERE u.id = $1`, `autoinvalidate` automatically indexes the cached result in Redis Sets under `table:users`, `table:orders`, and `table:users:id:42`.
> - ⚡ **O(1) Set-Based Invalidation (Zero `KEYS *` or `SCAN`):** When `UPDATE orders SET ...` runs, it atomically looks up `ai:tag:table:orders` and purges every affected query in `< 1ms`.
> - 🛡️ **Singleflight Stampede Protection:** 200 concurrent requests for an expired key coalesce into **1** SQL query.
> - 🔒 **Transaction-Safe:** Buffers invalidations inside `BEGIN ... COMMIT` and discards them on `ROLLBACK`.
>
> It’s 100% open-source (MIT) and weighs ~20kB packed. Would love your feedback on the architecture and what ORM/DB adapter (Mongoose, Prisma, Drizzle) you want next!

---

## 3. X / Twitter Viral Launch Thread (6 Tweets)

**Tweet 1/6 (Hook):**
Caching a PostgreSQL query in Redis takes 5 lines of code.
Invalidating that cache across `JOIN`s, transactions, and concurrent writes takes 500 lines of bug-prone spaghetti.

Today I’m open-sourcing **`autoinvalidate`** ⚡

Zero-config PostgreSQL (`pg`) + Redis query caching that invalidates itself automatically:
`npm i autoinvalidate` 🧵👇

**Tweet 2/6 (The Code):**
Drop it around your existing `pg.Pool` in 3 lines of TypeScript:

```ts
import { createAutoInvalidatePg, RedisCacheStore } from 'autoinvalidate';

const db = createAutoInvalidatePg(pgPool, {
  store: new RedisCacheStore(redis),
  defaultTtlMs: 60_000,
});
```

Your existing `await db.query(...)` calls don’t change at all.

**Tweet 3/6 (How JOIN Invalidation Works):**
What happens when you cache a `JOIN` query?

```sql
SELECT u.name, o.total FROM users u JOIN orders o ON o.user_id = u.id
```

`autoinvalidate` parses the SQL AST and tags the cache key under BOTH `table:users` and `table:orders` using O(1) Redis Sets (`SADD`).
Mutate `orders` -> the joined cache purges automatically. Zero `SCAN` or `KEYS *`.

**Tweet 4/6 (Stampede Protection):**
What happens when a hot cache key expires and 500 users hit your API at the exact same millisecond?

Built-in **Singleflight Request Coalescing** ensures only **1** query hits PostgreSQL, while the other 499 wait on the same Promise and return in `< 1ms`.

**Tweet 5/6 (Transaction Safety):**
What about `BEGIN` / `COMMIT` / `ROLLBACK`?

When you check out a client via `const client = await db.connect()`, `autoinvalidate` buffers write invalidations inside the transaction.
- `COMMIT` -> Flushes invalidations to Redis.
- `ROLLBACK` -> Discards queued invalidations so valid cache stays warm!

**Tweet 6/6 (CTA):**
`autoinvalidate` v1.0.0 is live on npm right now (MIT license, strict TypeScript, ESM + CJS, works with `ioredis`, `node-redis`, or in-memory LRU).

📦 `npm install autoinvalidate`
🌐 Interactive SQL Cache Simulator & Docs: https://autoinvalidate.dev

RT & star the repo if you hate stale cache bugs! ⭐

---

## 4. Reddit Launch Posts (`r/node`, `r/postgresql`, `r/javascript`)

### Title:
**[Open Source] I built `autoinvalidate` — a lightweight wrapper for `node-postgres` (`pg`) and Redis that automatically invalidates cached SELECT queries (including JOINs) on INSERT/UPDATE/DELETE**

### Body:
Hey `r/node`!

Whenever I work on a PERN stack project using raw SQL with `pg` and Redis (`ioredis` or `node-redis`), I end up writing custom cache-invalidation helpers in every controller/service. The moment a query joins 2 or 3 tables, someone inevitably forgets to clear a cache key when one of the joined tables is updated.

I built **`autoinvalidate`** to handle this transparently at the `pg.Pool` layer without needing an ORM:

### Key Technical Decisions:
1. **Zero `KEYS *` or `SCAN` in Redis:** Every cached query key (`ai:q:orders+users:<sha256>`) is indexed inside Redis Sets (`ai:tag:table:users`, `ai:tag:table:orders`, `ai:tag:table:users:id:42`). Invalidating a table is an O(M) `SMEMBERS` + `DEL` pipeline.
2. **Volatile SQL Detection:** Queries containing `NOW()`, `RANDOM()`, `NEXTVAL()`, or `FOR UPDATE` automatically bypass caching unless explicitly overridden.
3. **Transaction-Aware Proxy:** Checked-out pool clients (`await db.connect()`) track `BEGIN` / `COMMIT` / `ROLLBACK` state so rolled-back writes don't thrash the cache.
4. **Singleflight Coalescing:** Deduplicates concurrent identical cache misses in-flight.
5. **Fail-Open Design:** If Redis is unreachable, `autoinvalidate` logs via `hooks.onError` and falls back directly to PostgreSQL.

Would love code reviews, edge-case SQL queries to throw at the parser, and feedback from anyone running `pg` + Redis in production!

---

## 5. LinkedIn Launch Post

Most backend performance bottlenecks aren't caused by slow code—they're caused by hitting PostgreSQL thousands of times for the exact same `SELECT` query.

Why don't teams cache more aggressively in Redis?
Because **cache invalidation is terrifying**. Nobody wants a customer to update their billing status and still see stale data because a developer forgot a `redis.del()` call in one of 40 API endpoints.

Today, I’m excited to release **`autoinvalidate` (v1.0.0)** on npm—an open-source smart query cache for Node.js, PostgreSQL (`pg`), and Redis.

✅ Automatic SQL table & row-ID tag extraction (supports `JOIN`s & `WITH` CTEs)  
✅ O(1) Redis Set tag invalidation on `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE`  
✅ Built-in Singleflight cache stampede protection  
✅ Transaction-safe (`BEGIN` / `COMMIT` / `ROLLBACK`)  
✅ Zero external runtime dependencies, dual ESM + CommonJS, 100% TypeScript  

Try it out in 30 seconds:
`npm install autoinvalidate pg ioredis`

#nodejs #postgresql #redis #opensource #typescript #backend #webdevelopment #softwareengineering

---

## 6. NPM Publishing & Release Runbook

To publish `autoinvalidate` from this monorepo to the official npm registry:

```bash
# 1. Authenticate with npm
npm login

# 2. Run full build + test suite
npm test

# 3. Inspect tarball contents
npm pack --dry-run --workspace=autoinvalidate

# 4. Publish publicly to npmjs.com
npm run publish:pkg
```

