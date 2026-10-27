import { performance } from 'node:perf_hooks';
import { analyzeSql, buildQueryCacheKey, cleanTableName } from './sql-analyzer.js';
import { MemoryCacheStore } from './stores/memory.js';
import type {
  AutoInvalidateOptions,
  CachedQueryResult,
  CacheStats,
  CacheStore,
  PgQueryable,
  QueryCacheOptions,
  SqlAnalysisResult
} from './types.js';

export interface AutoInvalidatePgInstance<T extends PgQueryable = PgQueryable> {
  /**
   * Execute a SQL query with automatic read caching and write invalidation.
   */
  query<R = Record<string, unknown>>(
    queryTextOrConfig: string | { text: string; values?: unknown[]; cache?: QueryCacheOptions },
    values?: unknown[],
    cacheOptions?: QueryCacheOptions
  ): Promise<CachedQueryResult<R>>;

  /**
   * Check out a transaction-aware PostgreSQL client from the pool.
   */
  connect(): Promise<any>;

  /**
   * Manually invalidate all cached queries referencing the given PostgreSQL table names.
   */
  invalidateTables(tables: string[]): Promise<number>;

  /**
   * Manually invalidate all cached queries associated with the given tags.
   */
  invalidateTags(tags: string[]): Promise<number>;

  /**
   * Clear the entire query cache store.
   */
  clearCache(): Promise<void>;

  /**
   * Inspect live cache hit/miss/invalidation telemetry.
   */
  getStats(): CacheStats;

  /**
   * Reset telemetry counters to zero.
   */
  resetStats(): void;

  /**
   * Inspect how `autoinvalidate` parses and tags a SQL query without executing it.
   */
  analyzeQuery(sql: string, params?: unknown[]): SqlAnalysisResult;

  /**
   * Access the underlying raw `pg.Pool` or `pg.Client`.
   */
  readonly raw: T;

  /**
   * Access the active `CacheStore` instance.
   */
  readonly store: CacheStore;
}

/**
 * Wraps a `node-postgres` (`pg.Pool` or `pg.Client`) instance with automatic query caching
 * and write-driven invalidation.
 */
export function createAutoInvalidatePg<T extends PgQueryable>(
  poolOrClient: T,
  options: AutoInvalidateOptions = {}
): T & AutoInvalidatePgInstance<T> {
  const store: CacheStore = options.store ?? new MemoryCacheStore();
  const defaultTtlMs = options.defaultTtlMs ?? 60_000;
  const keyPrefix = options.keyPrefix ?? 'ai';
  const singleflight = options.singleflight ?? true;
  const includeMetadata = options.includeMetadata ?? true;
  const excludedTables = new Set((options.excludeTables ?? []).map((t) => cleanTableName(t)));
  const hooks = options.hooks ?? {};

  const inFlightQueries = new Map<string, Promise<CachedQueryResult<any>>>();

  let hits = 0;
  let misses = 0;
  let invalidations = 0;
  let invalidatedKeys = 0;
  let bypasses = 0;
  let coalescedRequests = 0;
  let errors = 0;
  let totalHitLatencyMs = 0;
  let totalMissLatencyMs = 0;

  async function safeInvalidateTags(tags: string[], tables: string[], sql?: string): Promise<number> {
    if (tags.length === 0) return 0;
    try {
      const removed = await store.invalidateTags(tags);
      invalidations++;
      invalidatedKeys += removed;
      hooks.onInvalidate?.({ tables, tags, invalidatedKeys: removed, sql });
      return removed;
    } catch (err) {
      errors++;
      hooks.onError?.(err, { phase: 'invalidate', sql });
      return 0;
    }
  }

  function createQueryExecutor(
    target: PgQueryable,
    txState?: { inTransaction: boolean; pendingTags: Set<string>; pendingTables: Set<string> }
  ) {
    return async function executeQuery<R = Record<string, unknown>>(
      queryTextOrConfig: string | { text: string; values?: unknown[]; cache?: QueryCacheOptions },
      values?: unknown[],
      cacheOptions?: QueryCacheOptions
    ): Promise<CachedQueryResult<R>> {
      const isConfigObject = typeof queryTextOrConfig === 'object' && queryTextOrConfig !== null;
      const sqlText = isConfigObject ? queryTextOrConfig.text : queryTextOrConfig;

      let resolvedValues: unknown[] | undefined = isConfigObject ? queryTextOrConfig.values : values;
      let resolvedCacheOpts: QueryCacheOptions | undefined = isConfigObject
        ? queryTextOrConfig.cache ?? cacheOptions
        : cacheOptions;

      // Support 2-argument call: query('SELECT ...', { ttlMs: 5000 }) where 2nd arg is QueryCacheOptions
      if (
        !isConfigObject &&
        values &&
        !Array.isArray(values) &&
        typeof values === 'object' &&
        cacheOptions === undefined
      ) {
        resolvedCacheOpts = values as unknown as QueryCacheOptions;
        resolvedValues = undefined;
      }

      if (typeof sqlText !== 'string') {
        bypasses++;
        return target.query(queryTextOrConfig as any, resolvedValues);
      }

      const analysis = analyzeSql(sqlText, resolvedValues);

      // Handle Transaction Boundaries (`BEGIN`, `COMMIT`, `ROLLBACK`)
      if (analysis.operation === 'BEGIN') {
        if (txState) {
          txState.inTransaction = true;
          txState.pendingTags.clear();
          txState.pendingTables.clear();
        }
        return target.query(queryTextOrConfig as any, resolvedValues);
      }

      if (analysis.operation === 'COMMIT') {
        const res = await target.query(queryTextOrConfig as any, resolvedValues);
        if (txState && txState.inTransaction) {
          const tagsToFlush = Array.from(txState.pendingTags);
          const tablesToFlush = Array.from(txState.pendingTables);
          txState.inTransaction = false;
          txState.pendingTags.clear();
          txState.pendingTables.clear();
          if (tagsToFlush.length > 0) {
            await safeInvalidateTags(tagsToFlush, tablesToFlush, 'COMMIT');
          }
        }
        return res;
      }

      if (analysis.operation === 'ROLLBACK') {
        const res = await target.query(queryTextOrConfig as any, resolvedValues);
        if (txState) {
          txState.inTransaction = false;
          txState.pendingTags.clear();
          txState.pendingTables.clear();
        }
        return res;
      }

      // Handle Write Mutations (`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `DDL`)
      if (analysis.isMutation) {
        const result = await target.query(
          isConfigObject ? { ...queryTextOrConfig, values: resolvedValues } : sqlText,
          isConfigObject ? undefined : resolvedValues
        );

        const customTags = resolvedCacheOpts?.tags ?? [];
        const tableLevelTags = analysis.tables.map((t) => `table:${t}`);
        const allInvalidationTags = Array.from(
          new Set([...tableLevelTags, ...analysis.rowTags, ...customTags])
        );

        if (txState?.inTransaction) {
          // Buffer tags until COMMIT so rollbacks don't evict valid cache entries unnecessarily
          for (const tag of allInvalidationTags) txState.pendingTags.add(tag);
          for (const table of analysis.tables) txState.pendingTables.add(table);
        } else {
          await safeInvalidateTags(allInvalidationTags, analysis.tables, analysis.normalizedSql);
        }

        return result;
      }

      // Determine whether this SELECT query should use cache
      const hasExcludedTable = analysis.tables.some((t) => excludedTables.has(t));
      const explicitCacheFlag = resolvedCacheOpts?.cache;
      const allowVolatile = resolvedCacheOpts?.allowVolatile ?? false;

      const canCache =
        !txState?.inTransaction &&
        explicitCacheFlag !== false &&
        !hasExcludedTable &&
        (explicitCacheFlag === true ||
          (analysis.isCacheableRead && (!analysis.hasVolatileFunctions || allowVolatile)));

      if (!canCache) {
        bypasses++;
        return target.query(
          isConfigObject ? { ...queryTextOrConfig, values: resolvedValues } : sqlText,
          isConfigObject ? undefined : resolvedValues
        );
      }

      const ttlMs = resolvedCacheOpts?.ttlMs ?? defaultTtlMs;
      const customTags = resolvedCacheOpts?.tags ?? [];
      const tags = Array.from(new Set([...analysis.allTags, ...customTags]));
      const cacheKey =
        resolvedCacheOpts?.key ??
        buildQueryCacheKey(analysis.normalizedSql, resolvedValues, analysis.tables, keyPrefix);

      const startTime = performance.now();

      // 1. Check Cache Store
      try {
        const cached = await store.get<CachedQueryResult<R>>(cacheKey);
        if (cached) {
          const latencyMs = Number((performance.now() - startTime).toFixed(3));
          hits++;
          totalHitLatencyMs += latencyMs;
          hooks.onHit?.({
            key: cacheKey,
            sql: analysis.normalizedSql,
            tags,
            latencyMs,
            coalesced: false
          });

          const response: CachedQueryResult<R> = {
            ...cached,
            rows: structuredClone(cached.rows)
          };
          if (includeMetadata) {
            response._cache = {
              hit: true,
              key: cacheKey,
              tags,
              latencyMs,
              coalesced: false
            };
          }
          return response;
        }
      } catch (err) {
        errors++;
        hooks.onError?.(err, { phase: 'get', sql: analysis.normalizedSql });
      }

      // 2. Singleflight Stampede Protection
      if (singleflight && inFlightQueries.has(cacheKey)) {
        const pendingPromise = inFlightQueries.get(cacheKey)!;
        const sharedResult = await pendingPromise;
        const latencyMs = Number((performance.now() - startTime).toFixed(3));
        hits++;
        coalescedRequests++;
        totalHitLatencyMs += latencyMs;
        hooks.onHit?.({
          key: cacheKey,
          sql: analysis.normalizedSql,
          tags,
          latencyMs,
          coalesced: true
        });

        const cloned: CachedQueryResult<R> = {
          ...sharedResult,
          rows: structuredClone(sharedResult.rows)
        };
        if (includeMetadata) {
          cloned._cache = {
            hit: true,
            key: cacheKey,
            tags,
            latencyMs,
            coalesced: true
          };
        }
        return cloned;
      }

      // 3. Cache Miss -> Execute against PostgreSQL
      const fetchPromise = (async (): Promise<CachedQueryResult<R>> => {
        const dbResult = await target.query(
          isConfigObject ? { ...queryTextOrConfig, values: resolvedValues } : sqlText,
          isConfigObject ? undefined : resolvedValues
        );

        const latencyMs = Number((performance.now() - startTime).toFixed(3));
        misses++;
        totalMissLatencyMs += latencyMs;
        hooks.onMiss?.({
          key: cacheKey,
          sql: analysis.normalizedSql,
          tags,
          latencyMs
        });

        const cacheableSnapshot: CachedQueryResult<R> = {
          rows: dbResult.rows,
          rowCount: dbResult.rowCount ?? dbResult.rows?.length ?? 0,
          command: dbResult.command ?? 'SELECT',
          oid: dbResult.oid ?? 0,
          fields: dbResult.fields ?? []
        };

        try {
          await store.set(cacheKey, cacheableSnapshot, tags, ttlMs);
        } catch (err) {
          errors++;
          hooks.onError?.(err, { phase: 'set', sql: analysis.normalizedSql });
        }

        if (includeMetadata) {
          dbResult._cache = {
            hit: false,
            key: cacheKey,
            tags,
            latencyMs,
            coalesced: false
          };
        }
        return dbResult;
      })();

      if (singleflight) {
        inFlightQueries.set(cacheKey, fetchPromise);
      }

      try {
        return await fetchPromise;
      } finally {
        if (singleflight) {
          inFlightQueries.delete(cacheKey);
        }
      }
    };
  }

  const rootQuery = createQueryExecutor(poolOrClient);

  const wrappedConnect = async () => {
    if (typeof poolOrClient.connect !== 'function') {
      throw new Error('[autoinvalidate] Underlying pg instance does not implement .connect().');
    }
    const client = await poolOrClient.connect();
    const txState = {
      inTransaction: false,
      pendingTags: new Set<string>(),
      pendingTables: new Set<string>()
    };
    const clientQuery = createQueryExecutor(client, txState);

    return new Proxy(client, {
      get(target, prop, receiver) {
        if (prop === 'query') return clientQuery;
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  const apiMethods: AutoInvalidatePgInstance<T> = {
    query: rootQuery,
    connect: wrappedConnect,
    async invalidateTables(tables: string[]): Promise<number> {
      const cleaned = tables.map((t) => cleanTableName(t)).filter(Boolean);
      const tags = cleaned.map((t) => `table:${t}`);
      return safeInvalidateTags(tags, cleaned, 'MANUAL_TABLE_INVALIDATION');
    },
    async invalidateTags(tags: string[]): Promise<number> {
      return safeInvalidateTags(tags, [], 'MANUAL_TAG_INVALIDATION');
    },
    async clearCache(): Promise<void> {
      await store.clear();
    },
    getStats(): CacheStats {
      const totalLookups = hits + misses;
      return {
        hits,
        misses,
        invalidations,
        invalidatedKeys,
        bypasses,
        coalescedRequests,
        errors,
        hitRate: totalLookups > 0 ? Number(((hits / totalLookups) * 100).toFixed(2)) : 0,
        avgHitLatencyMs: hits > 0 ? Number((totalHitLatencyMs / hits).toFixed(3)) : 0,
        avgMissLatencyMs: misses > 0 ? Number((totalMissLatencyMs / misses).toFixed(3)) : 0
      };
    },
    resetStats(): void {
      hits = 0;
      misses = 0;
      invalidations = 0;
      invalidatedKeys = 0;
      bypasses = 0;
      coalescedRequests = 0;
      errors = 0;
      totalHitLatencyMs = 0;
      totalMissLatencyMs = 0;
    },
    analyzeQuery(sql: string, params?: unknown[]): SqlAnalysisResult {
      return analyzeSql(sql, params);
    },
    raw: poolOrClient,
    store
  };

  return new Proxy(poolOrClient, {
    get(target, prop, receiver) {
      if (prop in apiMethods) {
        return (apiMethods as any)[prop];
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  }) as T & AutoInvalidatePgInstance<T>;
}

export { createAutoInvalidatePg as autoinvalidate };

