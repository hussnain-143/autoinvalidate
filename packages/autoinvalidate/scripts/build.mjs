import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const srcDir = path.join(pkgRoot, 'src');
const distDir = path.join(pkgRoot, 'dist');

// Clean and create dist directory
fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

const moduleOrder = [
  'types.ts',
  'sql-analyzer.ts',
  'stores/memory.ts',
  'stores/redis.ts',
  'pg-adapter.ts'
];

let bundledEsmBody = `import crypto from 'node:crypto';\nimport { performance } from 'node:perf_hooks';\n\n`;
let bundledDtsBody = `// Type definitions for autoinvalidate v1.0.0\n// Project: https://autoinvalidate-pi.vercel.app\n// Repository: https://github.com/hussnain-143/autoinvalidate\n\n`;

for (const relPath of moduleOrder) {
  const fullPath = path.join(srcDir, relPath);
  const rawTs = fs.readFileSync(fullPath, 'utf8');

  // Extract type declarations for .d.ts
  const cleanedForDts = rawTs
    .replace(/^import\s+.*?;$/gm, '')
    .trim();
  if (relPath === 'types.ts') {
    bundledDtsBody += cleanedForDts + '\n\n';
  }

  // Strip TypeScript types using Node 24 native API
  const jsCode = stripTypeScriptTypes(rawTs, { mode: 'strip' });

  // Remove internal imports since we bundle into a single clean zero-dep artifact
  const withoutImports = jsCode
    .replace(/^import\s+.*?;?\s*$/gm, '')
    .replace(/^export\s+\{\s*createAutoInvalidatePg\s+as\s+autoinvalidate\s*\};?\s*$/gm, '')
    .trim();

  if ( withoutImports ) {
    bundledEsmBody += `// --- ${relPath} ---\n${withoutImports}\n\n`;
  }
}

bundledEsmBody += `export { createAutoInvalidatePg as autoinvalidate };\nexport default createAutoInvalidatePg;\n`;

// Complete .d.ts signatures for functions and classes
bundledDtsBody += `
export interface MemoryCacheStoreOptions {
  maxEntries?: number;
}

export declare class MemoryCacheStore implements CacheStore {
  constructor(options?: MemoryCacheStoreOptions);
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, tags: string[], ttlMs: number): Promise<void>;
  invalidateTags(tags: string[]): Promise<number>;
  clear(): Promise<void>;
  getSize(): { entries: number; tags: number };
}

export interface RedisLikeClient {
  get(key: string): Promise<string | null | unknown>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: any[]): Promise<number>;
  sadd?(key: string, ...members: any[]): Promise<number>;
  smembers?(key: string): Promise<string[]>;
  pexpire?(key: string, milliseconds: number): Promise<number>;
  sAdd?(key: string, members: string | string[]): Promise<number>;
  sMembers?(key: string): Promise<string[]>;
  pExpire?(key: string, milliseconds: number): Promise<number | boolean>;
}

export interface RedisCacheStoreOptions {
  tagPrefix?: string;
}

export declare class RedisCacheStore implements CacheStore {
  constructor(redisClient: RedisLikeClient, options?: RedisCacheStoreOptions);
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, tags: string[], ttlMs: number): Promise<void>;
  invalidateTags(tags: string[]): Promise<number>;
  clear(): Promise<void>;
}

export interface AutoInvalidatePgInstance<T extends PgQueryable = PgQueryable> {
  query<R = Record<string, unknown>>(
    queryTextOrConfig: string | { text: string; values?: unknown[]; cache?: QueryCacheOptions },
    values?: unknown[],
    cacheOptions?: QueryCacheOptions
  ): Promise<CachedQueryResult<R>>;
  connect(): Promise<any>;
  invalidateTables(tables: string[]): Promise<number>;
  invalidateTags(tags: string[]): Promise<number>;
  clearCache(): Promise<void>;
  getStats(): CacheStats;
  resetStats(): void;
  analyzeQuery(sql: string, params?: unknown[]): SqlAnalysisResult;
  readonly raw: T;
  readonly store: CacheStore;
}

export declare function normalizeSql(sql: string): string;
export declare function cleanTableName(rawIdentifier: string): string;
export declare function detectSqlOperation(normalizedSql: string): SqlOperation;
export declare function extractTables(normalizedSql: string): string[];
export declare function extractRowTags(normalizedSql: string, tables: string[], params?: unknown[]): string[];
export declare function analyzeSql(sql: string, params?: unknown[]): SqlAnalysisResult;
export declare function buildQueryCacheKey(
  normalizedSql: string,
  params: unknown[] | undefined,
  tables: string[],
  keyPrefix?: string
): string;

export declare function createAutoInvalidatePg<T extends PgQueryable>(
  poolOrClient: T,
  options?: AutoInvalidateOptions
): T & AutoInvalidatePgInstance<T>;

export { createAutoInvalidatePg as autoinvalidate };
export default createAutoInvalidatePg;
`;

// Write ESM output (`dist/index.mjs`)
fs.writeFileSync(path.join(distDir, 'index.mjs'), bundledEsmBody, 'utf8');

// Convert ESM exports to CommonJS (`dist/index.cjs`)
const cjsBody = bundledEsmBody
  .replace(`import crypto from 'node:crypto';`, `const crypto = require('node:crypto');`)
  .replace(`import { performance } from 'node:perf_hooks';`, `const { performance } = require('node:perf_hooks');`)
  .replace(/^export\s+(async\s+)?function\s+([a-zA-Z0-9_]+)/gm, '$1function $2')
  .replace(/^export\s+class\s+([a-zA-Z0-9_]+)/gm, 'class $1')
  .replace(/^export\s+\{\s*createAutoInvalidatePg\s+as\s+autoinvalidate\s*\};?/gm, '')
  .replace(/^export\s+default\s+createAutoInvalidatePg;?/gm, '') +
  `\nfunction defaultExport(...args) { return createAutoInvalidatePg(...args); }\n` +
  `defaultExport.createAutoInvalidatePg = createAutoInvalidatePg;\n` +
  `defaultExport.autoinvalidate = createAutoInvalidatePg;\n` +
  `defaultExport.RedisCacheStore = RedisCacheStore;\n` +
  `defaultExport.MemoryCacheStore = MemoryCacheStore;\n` +
  `defaultExport.analyzeSql = analyzeSql;\n` +
  `defaultExport.normalizeSql = normalizeSql;\n` +
  `defaultExport.extractTables = extractTables;\n` +
  `defaultExport.extractRowTags = extractRowTags;\n` +
  `defaultExport.detectSqlOperation = detectSqlOperation;\n` +
  `defaultExport.buildQueryCacheKey = buildQueryCacheKey;\n` +
  `defaultExport.cleanTableName = cleanTableName;\n` +
  `defaultExport.default = defaultExport;\n` +
  `module.exports = defaultExport;\n`;

fs.writeFileSync(path.join(distDir, 'index.cjs'), cjsBody, 'utf8');
fs.writeFileSync(path.join(distDir, 'index.d.ts'), bundledDtsBody, 'utf8');
fs.writeFileSync(path.join(distDir, 'index.d.mts'), bundledDtsBody, 'utf8');

console.log('✓ Built autoinvalidate -> dist/index.mjs, dist/index.cjs, dist/index.d.ts');

