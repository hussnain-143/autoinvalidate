'use client';

import React, { useState } from 'react';
import InteractiveSqlPlayground from './components/InteractiveSqlPlayground';

export default function HomePage() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText('npm install autoinvalidate pg');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="container">
      {/* Hero Section */}
      <section className="hero">
        <div className="hero-pill">
          <span>⚡</span> v1.0.0 Live on NPM • Zero-Config PG Cache
        </div>

        <h1 className="hero-title">
          PostgreSQL Query Caching That <br />
          <span className="text-gradient">Invalidates Itself Automatically</span>
        </h1>

        <p className="hero-desc">
          Stop writing brittle <code>redis.del()</code> calls across your backend controllers.
          Wrap your <code>pg.Pool</code> once: every <code>SELECT</code> query is cached in-memory (or in Redis)
          and instantly purged whenever an <code>INSERT</code>, <code>UPDATE</code>, or <code>DELETE</code> runs.
        </p>

        {/* CTA Buttons & Install Bar */}
        <div className="hero-cta">
          <div className="install-box">
            <code>npm install autoinvalidate pg</code>
            <button className="copy-btn" onClick={handleCopy}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>

          <a
            href="https://github.com/hussnain-143/autoinvalidate"
            target="_blank"
            rel="noreferrer"
            className="btn btn-primary"
          >
            <span>GitHub Repository</span> →
          </a>
        </div>
      </section>

      {/* Interactive Simulator */}
      <section id="simulator">
        <InteractiveSqlPlayground />
      </section>

      {/* Feature Pillars */}
      <section id="features" style={{ padding: '40px 0' }}>
        <div className="section-header">
          <div className="section-tag">Engine Highlights</div>
          <h2 className="section-title">Built for Production Node.js & PostgreSQL</h2>
        </div>

        <div className="grid-3">
          <div className="card">
            <div className="card-icon">⚡</div>
            <h3 className="card-title">Zero-Config In-Memory</h3>
            <p className="card-desc">
              Works out-of-the-box with <strong>zero external services or Redis setup</strong>.
              Uses an ultra-fast in-process LRU cache with sub-millisecond retrieval.
            </p>
          </div>

          <div className="card">
            <div className="card-icon">🚀</div>
            <h3 className="card-title">Seamless Redis Sets</h3>
            <p className="card-desc">
              Upgrade to distributed multi-container caching by passing <code>new RedisCacheStore(redis)</code>.
              Uses atomic Redis Sets (<code>SADD</code> / <code>SMEMBERS</code> / <code>DEL</code>) with <strong>zero <code>KEYS *</code> or <code>SCAN</code></strong>.
            </p>
          </div>

          <div className="card">
            <div className="card-icon">🧠</div>
            <h3 className="card-title">SQL AST & Tagging</h3>
            <p className="card-desc">
              Parses <code>SELECT</code>, <code>JOIN</code>s, CTEs, and row IDs automatically.
              Queries referencing multiple tables are indexed under each table tag.
            </p>
          </div>

          <div className="card">
            <div className="card-icon">🛡️</div>
            <h3 className="card-title">Singleflight Stampede Shield</h3>
            <p className="card-desc">
              If 500 concurrent requests hit an expired cache key at the exact same millisecond,
              only <strong>1</strong> query hits PostgreSQL while all 500 share the result.
            </p>
          </div>

          <div className="card">
            <div className="card-icon">🔒</div>
            <h3 className="card-title">Transaction-Aware</h3>
            <p className="card-desc">
              Buffers invalidations inside <code>BEGIN ... COMMIT</code> transactions.
              Cache tags are flushed only when committed, and safely discarded on <code>ROLLBACK</code>.
            </p>
          </div>

          <div className="card">
            <div className="card-icon">📊</div>
            <h3 className="card-title">Live Telemetry & Stats</h3>
            <p className="card-desc">
              Inspect real-time hit/miss rates, invalidation counts, coalesced requests,
              and average latencies via <code>db.getStats()</code>.
            </p>
          </div>
        </div>
      </section>

      {/* Quickstart Code Section */}
      <section id="quickstart" style={{ padding: '40px 0' }}>
        <div className="section-header">
          <div className="section-tag">Quickstart</div>
          <h2 className="section-title">Drop-In Replacement for pg.Pool</h2>
        </div>

        <pre>
{`import { Pool } from 'pg';
import autoinvalidate from 'autoinvalidate';

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ⚡ 1 line wrap — Works immediately with in-memory LRU cache!
export const db = autoinvalidate(rawPool);

// 1️⃣ First query -> Cache MISS (Queries PostgreSQL, caches in-memory under 'table:users' & 'table:orders')
const res1 = await db.query(
  \`SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1\`,
  [42]
);
console.log(res1._cache); // { hit: false, latencyMs: 14.2, tags: ['table:users', 'table:orders', 'table:users:id:42'] }

// 2️⃣ Second query -> Cache HIT (< 0.1ms from cache, 0 PostgreSQL load!)
const res2 = await db.query(
  \`SELECT u.id, u.name, o.total
   FROM users u
   JOIN orders o ON o.user_id = u.id
   WHERE u.id = $1\`,
  [42]
);
console.log(res2._cache.hit); // true!

// 3️⃣ Mutate 'orders' -> Automatically purges all cached queries referencing 'orders'!
await db.query(\`UPDATE orders SET total = $1 WHERE user_id = $2\`, [199.99, 42]);`}
        </pre>
      </section>

      {/* Redis Mode */}
      <section id="redis" style={{ padding: '40px 0' }}>
        <div className="section-header">
          <div className="section-tag">Distributed Scaling</div>
          <h2 className="section-title">Scale Across Clusters with Redis</h2>
        </div>

        <pre>
{`import { Pool } from 'pg';
import Redis from 'ioredis';
import autoinvalidate, { RedisCacheStore } from 'autoinvalidate';

const rawPool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL);

// 🚀 Distributed across all containers via atomic Redis Sets:
export const db = autoinvalidate(rawPool, {
  store: new RedisCacheStore(redis),
  defaultTtlMs: 60_000, // 60s TTL
  singleflight: true
});`}
        </pre>
      </section>

      {/* Comparison Table */}
      <section id="benchmarks" style={{ padding: '40px 0' }}>
        <div className="section-header">
          <div className="section-tag">Comparison</div>
          <h2 className="section-title">Why autoinvalidate?</h2>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Feature</th>
                <th>autoinvalidate</th>
                <th>Manual redis.del()</th>
                <th>ORM Query Caching</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Setup Effort</strong></td>
                <td><span className="badge-emerald">1 Line Wrapper</span></td>
                <td>100s of lines of boilerplate</td>
                <td>Requires full ORM migration</td>
              </tr>
              <tr>
                <td><strong>JOIN Invalidation</strong></td>
                <td><span className="badge-emerald">Automatic AST Indexing</span></td>
                <td>Manual & highly error-prone</td>
                <td>Partial / Incomplete</td>
              </tr>
              <tr>
                <td><strong>Redis Overhead</strong></td>
                <td><span className="badge-emerald">O(1) Sets (Zero KEYS / SCAN)</span></td>
                <td>Often uses dangerous SCAN</td>
                <td>Varies</td>
              </tr>
              <tr>
                <td><strong>Stampede Protection</strong></td>
                <td><span className="badge-emerald">Built-in Singleflight</span></td>
                <td>Requires custom distributed locks</td>
                <td>None / Plugin required</td>
              </tr>
              <tr>
                <td><strong>Transaction Safety</strong></td>
                <td><span className="badge-emerald">Buffers until COMMIT</span></td>
                <td>Stale if transaction rolls back</td>
                <td>Rarely handled</td>
              </tr>
              <tr>
                <td><strong>In-Memory Fallback</strong></td>
                <td><span className="badge-emerald">Default Zero-Dep LRU</span></td>
                <td>Requires manual fallback code</td>
                <td>None</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

