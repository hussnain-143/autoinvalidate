'use client';

import React, { useState, useMemo } from 'react';

interface PresetQuery {
  label: string;
  sql: string;
  type: 'select' | 'update' | 'insert' | 'delete' | 'join';
}

const PRESETS: PresetQuery[] = [
  {
    label: 'Joined SELECT Query',
    sql: `SELECT u.id, u.name, o.total, o.created_at\nFROM users u\nJOIN orders o ON o.user_id = u.id\nWHERE u.id = 42\nORDER BY o.created_at DESC;`,
    type: 'join',
  },
  {
    label: 'UPDATE Invalidation',
    sql: `UPDATE orders\nSET total = 199.99, updated_at = NOW()\nWHERE user_id = 42;`,
    type: 'update',
  },
  {
    label: 'INSERT Record',
    sql: `INSERT INTO users (name, email)\nVALUES ('Alice Smith', 'alice@example.com');`,
    type: 'insert',
  },
  {
    label: 'DELETE Cascade',
    sql: `DELETE FROM orders\nWHERE id = 801;`,
    type: 'delete',
  },
];

export default function InteractiveSqlPlayground() {
  const [sql, setSql] = useState<string>(PRESETS[0].sql);
  const [activePreset, setActivePreset] = useState<number>(0);

  const analysis = useMemo(() => {
    const trimmed = sql.trim();
    const upper = trimmed.toUpperCase();

    const isSelect = upper.startsWith('SELECT');
    const isUpdate = upper.startsWith('UPDATE');
    const isInsert = upper.startsWith('INSERT');
    const isDelete = upper.startsWith('DELETE');
    const isTruncate = upper.startsWith('TRUNCATE');

    // Extract table names
    const tables = new Set<string>();
    
    // Simple robust regex heuristic for playground visualization
    const fromMatches = trimmed.matchAll(/(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+([a-zA-Z0-9_]+)/gi);
    for (const match of fromMatches) {
      if (match[1]) tables.add(match[1].toLowerCase());
    }

    // Extract potential row IDs
    const idMatches = trimmed.matchAll(/(?:id|user_id|order_id)\s*=\s*([0-9]+)/gi);
    const rowTags: string[] = [];
    for (const match of idMatches) {
      if (match[1]) rowTags.push(`row:id:${match[1]}`);
    }

    const tableList = Array.from(tables);
    const tableTags = tableList.map((t) => `table:${t}`);
    const allTags = [...tableTags, ...rowTags];

    if (isSelect) {
      return {
        mode: 'SELECT (Query Cache)',
        status: 'CACHE HIT / MISS',
        latency: '0.09ms (In-Memory) / 0.45ms (Redis)',
        tables: tableList,
        tags: allTags,
        redisCmds: [
          `SADD ai:tag:${tableTags[0] || 'table:unknown'} [cache_key_hash]`,
          ...(tableTags.length > 1 ? [`SADD ai:tag:${tableTags[1]} [cache_key_hash]`] : []),
          `SET ai:val:[hash] [json_data] EX 60`,
        ],
        singleflight: 'Active (Coalesces concurrent requests to 1 PG query)',
        impact: `Safe to cache. In-flight queries will invalidate if any of [${tableList.join(', ')}] are updated.`,
      };
    } else {
      return {
        mode: 'MUTATION (Auto Invalidation)',
        status: 'ATOMIC CACHE PURGE',
        latency: '< 0.3ms Invalidation Overhead',
        tables: tableList,
        tags: tableTags,
        redisCmds: [
          `SMEMBERS ai:tag:${tableTags[0] || 'table:unknown'} -> returns affected keys`,
          `DEL [affected_keys...]`,
          `DEL ai:tag:${tableTags[0] || 'table:unknown'}`,
        ],
        singleflight: 'Bypassed (Mutations execute directly on PostgreSQL Pool)',
        impact: `Instantly flushes all cached SELECT queries touching [${tableList.join(', ')}]. Zero stale reads!`,
      };
    }
  }, [sql]);

  return (
    <div className="playground-box">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: '700', letterSpacing: '-0.01em' }}>
            ⚡ Live SQL AST & Invalidation Simulator
          </h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>
            Type any SQL statement below to simulate real-time table extraction, tag indexing, and cache invalidation.
          </p>
        </div>
        <span className="badge-cobalt" style={{ fontSize: '0.78rem', fontWeight: '600' }}>
          Zero-Config PG Proxy
        </span>
      </div>

      {/* Preset Buttons */}
      <div className="preset-buttons">
        {PRESETS.map((p, idx) => (
          <button
            key={p.label}
            className={`preset-btn ${activePreset === idx ? 'active' : ''}`}
            onClick={() => {
              setActivePreset(idx);
              setSql(p.sql);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Interactive SQL Input */}
      <textarea
        className="sql-input"
        value={sql}
        onChange={(e) => {
          setSql(e.target.value);
          setActivePreset(-1);
        }}
        rows={4}
        placeholder="Enter any SQL query (e.g. SELECT * FROM users WHERE id = 1)..."
      />

      {/* Live Simulation Results */}
      <div className="sim-output-grid">
        <div className="sim-metric">
          <div className="sim-metric-label">Detected Operation</div>
          <div className="sim-metric-val">
            <span className={analysis.mode.startsWith('SELECT') ? 'badge-emerald' : 'badge-crimson'}>
              {analysis.mode}
            </span>
          </div>
        </div>

        <div className="sim-metric">
          <div className="sim-metric-label">Estimated Latency</div>
          <div className="sim-metric-val" style={{ color: 'var(--emerald)' }}>
            {analysis.latency}
          </div>
        </div>

        <div className="sim-metric">
          <div className="sim-metric-label">Extracted Target Tables</div>
          <div className="sim-metric-val" style={{ color: 'var(--cobalt)' }}>
            {analysis.tables.length > 0 ? analysis.tables.join(', ') : 'None detected'}
          </div>
        </div>

        <div className="sim-metric">
          <div className="sim-metric-label">Singleflight Protection</div>
          <div className="sim-metric-val" style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
            {analysis.singleflight}
          </div>
        </div>
      </div>

      {/* Tags and Redis Commands */}
      <div style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        <div className="sim-metric">
          <div className="sim-metric-label">Associated Cache Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            {analysis.tags.map((tag) => (
              <span key={tag} style={{ background: '#24201D', border: '1px solid #3F3A35', borderRadius: '4px', padding: '2px 8px', fontSize: '0.8rem', fontFamily: 'var(--font-mono)' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="sim-metric">
          <div className="sim-metric-label">Underlying Redis Operations</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: '#CBD5E1', marginTop: '6px', lineHeight: '1.5' }}>
            {analysis.redisCmds.map((cmd, i) => (
              <div key={i}><code>{cmd}</code></div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

