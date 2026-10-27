export {
  createAutoInvalidatePg,
  autoinvalidate,
  type AutoInvalidatePgInstance
} from './pg-adapter.js';

export default createAutoInvalidatePg;

export {
  RedisCacheStore,
  type RedisLikeClient,
  type RedisCacheStoreOptions
} from './stores/redis.js';

export {
  MemoryCacheStore,
  type MemoryCacheStoreOptions
} from './stores/memory.js';

export {
  analyzeSql,
  normalizeSql,
  extractTables,
  extractRowTags,
  detectSqlOperation,
  buildQueryCacheKey,
  cleanTableName
} from './sql-analyzer.js';

export type {
  SqlOperation,
  SqlAnalysisResult,
  CacheEntryMetadata,
  StoredCachePayload,
  CacheStore,
  QueryCacheOptions,
  CacheMetadataResult,
  CachedQueryResult,
  CacheStats,
  AutoInvalidateHooks,
  AutoInvalidateOptions,
  PgQueryable
} from './types.js';

