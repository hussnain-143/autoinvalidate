export type SqlOperation =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'TRUNCATE'
  | 'BEGIN'
  | 'COMMIT'
  | 'ROLLBACK'
  | 'DDL'
  | 'OTHER';

export interface SqlAnalysisResult {
  operation: SqlOperation;
  normalizedSql: string;
  tables: string[];
  rowTags: string[];
  allTags: string[];
  isCacheableRead: boolean;
  isMutation: boolean;
  hasVolatileFunctions: boolean;
}

export interface CacheEntryMetadata {
  key: string;
  tags: string[];
  createdAt: number;
  ttlMs: number;
}

export interface StoredCachePayload<T = unknown> {
  data: T;
  tags: string[];
  createdAt: number;
  expiresAt: number;
}

export interface CacheStore {
  /**
   * Retrieve a cached query result by key.
   */
  get<T = unknown>(key: string): Promise<T | null>;

  /**
   * Store a query result with its associated invalidation tags and TTL in milliseconds.
   */
  set<T = unknown>(key: string, value: T, tags: string[], ttlMs: number): Promise<void>;

  /**
   * Atomically invalidate all cache keys associated with the given tags.
   * Returns the number of invalidated cache keys.
   */
  invalidateTags(tags: string[]): Promise<number>;

  /**
   * Clear all cache keys managed by this store.
   */
  clear(): Promise<void>;
}

export interface QueryCacheOptions {
  /**
   * Override whether this specific query should be cached (or bypass cache).
   */
  cache?: boolean;
  /**
   * Custom TTL in milliseconds for this query.
   */
  ttlMs?: number;
  /**
   * Additional custom tags to attach to this query (or invalidate on mutation).
   */
  tags?: string[];
  /**
   * Custom cache key override.
   */
  key?: string;
  /**
   * Force caching even if the query uses volatile SQL functions like NOW().
   */
  allowVolatile?: boolean;
}

export interface CacheMetadataResult {
  hit: boolean;
  key: string;
  tags: string[];
  latencyMs: number;
  coalesced?: boolean;
}

export interface CachedQueryResult<R = Record<string, unknown>> {
  rows: R[];
  rowCount: number | null;
  command: string;
  oid: number;
  fields: unknown[];
  _cache?: CacheMetadataResult;
}

export interface CacheStats {
  hits: number;
  misses: number;
  invalidations: number;
  invalidatedKeys: number;
  bypasses: number;
  coalescedRequests: number;
  errors: number;
  hitRate: number;
  avgHitLatencyMs: number;
  avgMissLatencyMs: number;
}

export interface AutoInvalidateHooks {
  onHit?: (info: { key: string; sql: string; tags: string[]; latencyMs: number; coalesced: boolean }) => void;
  onMiss?: (info: { key: string; sql: string; tags: string[]; latencyMs: number }) => void;
  onInvalidate?: (info: { tables: string[]; tags: string[]; invalidatedKeys: number; sql?: string }) => void;
  onError?: (error: unknown, context: { phase: 'get' | 'set' | 'invalidate'; sql?: string }) => void;
}

export interface AutoInvalidateOptions {
  /**
   * Cache storage adapter (e.g., RedisCacheStore or MemoryCacheStore).
   */
  store?: CacheStore;
  /**
   * Default TTL in milliseconds for cached SELECT queries. Default: 60_000 (60 seconds).
   */
  defaultTtlMs?: number;
  /**
   * Prefix for all cache keys. Default: 'ai'.
   */
  keyPrefix?: string;
  /**
   * Enable singleflight request coalescing to prevent cache stampedes. Default: true.
   */
  singleflight?: boolean;
  /**
   * Attach `_cache` metadata property to returned `pg` QueryResult objects. Default: true.
   */
  includeMetadata?: boolean;
  /**
   * Tables that should never be cached when queried.
   */
  excludeTables?: string[];
  /**
   * Lifecycle hooks for observability, logging, or Prometheus metrics.
   */
  hooks?: AutoInvalidateHooks;
}

export interface PgQueryable {
  query(queryTextOrConfig: string | { text: string; values?: unknown[]; cache?: QueryCacheOptions }, values?: unknown[], cacheOptions?: QueryCacheOptions): Promise<any>;
  connect?: () => Promise< any >;
  end?: () => Promise<void>;
}

