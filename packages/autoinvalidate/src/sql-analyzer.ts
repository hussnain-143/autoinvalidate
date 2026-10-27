import crypto from 'node:crypto';
import type { SqlAnalysisResult, SqlOperation } from './types.js';

const VOLATILE_SQL_REGEX =
  /\b(?:NOW\s*\(|CURRENT_TIMESTAMP\b|CLOCK_TIMESTAMP\s*\(|STATEMENT_TIMESTAMP\s*\(|TRANSACTION_TIMESTAMP\s*\(|RANDOM\s*\(|GEN_RANDOM_UUID\s*\(|UUID_GENERATE_V4\s*\(|NEXTVAL\s*\(|CURRVAL\s*\(|SETVAL\s*\(|PG_SLEEP\s*\()/i;

const LOCKING_CLAUSE_REGEX = /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i;

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'join', 'inner', 'left', 'right', 'full', 'outer',
  'cross', 'on', 'as', 'and', 'or', 'not', 'in', 'exists', 'between', 'like',
  'ilike', 'is', 'null', 'true', 'false', 'order', 'by', 'group', 'having',
  'limit', 'offset', 'fetch', 'first', 'next', 'rows', 'only', 'union', 'all',
  'intersect', 'except', 'insert', 'into', 'values', 'update', 'set', 'delete',
  'returning', 'with', 'recursive', 'lateral', 'unnest', 'json_table', 'unnest',
  'case', 'when', 'then', 'else', 'end', 'asc', 'desc', 'nulls', 'last', 'distinct'
]);

/**
 * Strips SQL comments and collapses redundant whitespace outside string literals.
 */
export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cleans a raw SQL table identifier (strips schema prefix like `public.` and quotes).
 */
export function cleanTableName(rawIdentifier: string): string {
  const cleaned = rawIdentifier
    .replace(/["`[\]]/g, '')
    .trim()
    .toLowerCase();
  const parts = cleaned.split('.');
  return parts[parts.length - 1] || '';
}

/**
 * Detects the top-level SQL operation.
 */
export function detectSqlOperation(normalizedSql: string): SqlOperation {
  const upper = normalizedSql.toUpperCase();

  if (/^(BEGIN|START\s+TRANSACTION)\b/.test(upper)) return 'BEGIN';
  if (/^(COMMIT|END)\b/.test(upper)) return 'COMMIT';
  if (/^ROLLBACK\b/.test(upper)) return 'ROLLBACK';
  if (/^TRUNCATE\b/.test(upper)) return 'TRUNCATE';
  if (/^(ALTER|DROP|CREATE)\b/.test(upper)) return 'DDL';

  // Handle CTEs (`WITH ... SELECT / INSERT / UPDATE / DELETE`)
  if (/^WITH\b/.test(upper)) {
    if (/\bINSERT\s+INTO\b/.test(upper)) return 'INSERT';
    if (/\bUPDATE\s+[A-Z0-9_."]+\s+SET\b/.test(upper)) return 'UPDATE';
    if (/\bDELETE\s+FROM\b/.test(upper)) return 'DELETE';
    return 'SELECT';
  }

  if (/^SELECT\b/.test(upper)) return 'SELECT';
  if (/^INSERT\b/.test(upper)) return 'INSERT';
  if (/^UPDATE\b/.test(upper)) return 'UPDATE';
  if (/^DELETE\b/.test(upper)) return 'DELETE';

  return 'OTHER';
}

/**
 * Extracts CTE alias names from `WITH alias_name AS (...)` so we don't mistake CTE names for real tables.
 */
function extractCteNames(normalizedSql: string): Set<string> {
  const cteNames = new Set<string>();
  if (!/^WITH\b/i.test(normalizedSql)) return cteNames;

  const cteRegex = /\b(?:WITH(?:\s+RECURSIVE)?|,)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = cteRegex.exec(normalizedSql)) !== null) {
    cteNames.add(match[1].toLowerCase());
  }
  return cteNames;
}

/**
 * Extracts all underlying PostgreSQL table names referenced by a SQL query.
 */
export function extractTables(normalizedSql: string): string[] {
  const cteNames = extractCteNames(normalizedSql);
  const tables = new Set<string>();

  const addCandidate = (raw: string | undefined) => {
    if (!raw) return;
    if (raw.startsWith('(')) return;
    const table = cleanTableName(raw);
    if (
      table &&
      !SQL_KEYWORDS.has(table) &&
      !cteNames.has(table) &&
      /^[a-z_][a-z0-9_]*$/.test(table)
    ) {
      tables.add(table);
    }
  };

  // 1. FROM <table1>, <table2> (handles comma-separated tables and schema.table)
  const fromRegex = /\bFROM\s+([a-zA-Z0-9_."`]+(?:\s+(?:AS\s+)?[a-zA-Z0-9_]+)?(?:\s*,\s*[a-zA-Z0-9_."`]+(?:\s+(?:AS\s+)?[a-zA-Z0-9_]+)?)*)/gi;
  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(normalizedSql)) !== null) {
    const clause = match[1];
    const items = clause.split(',');
    for (const item of items) {
      const firstToken = item.trim().split(/\s+/)[0];
      addCandidate(firstToken);
    }
  }

  // 2. JOIN <table>
  const joinRegex = /\bJOIN\s+([a-zA-Z0-9_."`]+)/gi;
  while ((match = joinRegex.exec(normalizedSql)) !== null) {
    addCandidate(match[1]);
  }

  // 3. INSERT INTO <table>
  const insertRegex = /\bINSERT\s+INTO\s+([a-zA-Z0-9_."`]+)/gi;
  while ((match = insertRegex.exec(normalizedSql)) !== null) {
    addCandidate(match[1]);
  }

  // 4. UPDATE <table>
  const updateRegex = /\bUPDATE\s+(?:ONLY\s+)?([a-zA-Z0-9_."`]+)/gi;
  while ((match = updateRegex.exec(normalizedSql)) !== null) {
    addCandidate(match[1]);
  }

  // 5. DELETE FROM <table>
  const deleteRegex = /\bDELETE\s+FROM\s+(?:ONLY\s+)?([a-zA-Z0-9_."`]+)/gi;
  while ((match = deleteRegex.exec(normalizedSql)) !== null) {
    addCandidate(match[1]);
  }

  // 6. TRUNCATE [TABLE] <table1>, <table2>
  if (/^TRUNCATE\b/i.test(normalizedSql)) {
    const truncateMatch = normalizedSql.match(
      /^TRUNCATE\s+(?:TABLE\s+)?(?:ONLY\s+)?([a-zA-Z0-9_."`,\s]+?)(?:\s+(?:RESTART|CONTINUE|CASCADE|RESTRICT)\b|$)/i
    );
    if (truncateMatch?.[1]) {
      for (const part of truncateMatch[1].split(',')) {
        addCandidate(part.trim().split(/\s+/)[0]);
      }
    }
  }

  // 7. ALTER / DROP TABLE <table>
  const ddlRegex = /\b(?:ALTER|DROP)\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-zA-Z0-9_."`]+)/gi;
  while ((match = ddlRegex.exec(normalizedSql)) !== null) {
    addCandidate(match[1]);
  }

  return Array.from(tables);
}

/**
 * Extracts fine-grained row tags when equality conditions on `id` or `*_id` are present with bound parameters or literals.
 */
export function extractRowTags(
  normalizedSql: string,
  tables: string[],
  params?: unknown[]
): string[] {
  if (tables.length === 0) return [];
  const primaryTable = tables[0];
  const rowTags = new Set<string>();

  // Match WHERE/AND [alias.]id = $1 or [alias.]id = 123 or 'abc'
  const idMatchRegex =
    /\b(?:WHERE|AND)\s+(?:[a-zA-Z0-9_]+\.)?(id|[a-zA-Z0-9_]+_id)\s*=\s*(\$(\d+)|'([^']+)'|(\d+))\b/gi;
  let match: RegExpExecArray | null;
  while ((match = idMatchRegex.exec(normalizedSql)) !== null) {
    const column = match[1].toLowerCase();
    const paramIndexStr = match[3];
    const stringLiteral = match[4];
    const numberLiteral = match[5];

    let resolvedValue: string | undefined;
    if (paramIndexStr && Array.isArray(params)) {
      const idx = parseInt(paramIndexStr, 10) - 1;
      const val = params[idx];
      if (val !== undefined && val !== null && (typeof val === 'string' || typeof val === 'number')) {
        resolvedValue = String(val);
      }
    } else if (stringLiteral !== undefined) {
      resolvedValue = stringLiteral;
    } else if (numberLiteral !== undefined) {
      resolvedValue = numberLiteral;
    }

    if (resolvedValue !== undefined) {
      if (column === 'id') {
        rowTags.add(`table:${primaryTable}:id:${resolvedValue}`);
      } else {
        rowTags.add(`table:${primaryTable}:${column}:${resolvedValue}`);
      }
    }
  }

  return Array.from(rowTags);
}

/**
 * Performs complete static & parameter analysis of a SQL query for caching and invalidation.
 */
export function analyzeSql(sql: string, params?: unknown[]): SqlAnalysisResult {
  const normalizedSql = normalizeSql(sql);
  const operation = detectSqlOperation(normalizedSql);
  const tables = extractTables(normalizedSql);
  const rowTags = extractRowTags(normalizedSql, tables, params);

  const tableTags = tables.map((t) => `table:${t}`);
  const allTags = Array.from(new Set([...tableTags, ...rowTags]));

  const hasVolatileFunctions =
    VOLATILE_SQL_REGEX.test(normalizedSql) || LOCKING_CLAUSE_REGEX.test(normalizedSql);

  // A SELECT query is cacheable if it doesn't contain RETURNING/INTO mutations or locking clauses
  const hasMutatingCte =
    operation === 'SELECT' && /\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i.test(normalizedSql);

  const isCacheableRead =
    operation === 'SELECT' &&
    !hasMutatingCte &&
    tables.length > 0 &&
    !hasVolatileFunctions;

  const isMutation =
    operation === 'INSERT' ||
    operation === 'UPDATE' ||
    operation === 'DELETE' ||
    operation === 'TRUNCATE' ||
    operation === 'DDL' ||
    hasMutatingCte;

  return {
    operation,
    normalizedSql,
    tables,
    rowTags,
    allTags,
    isCacheableRead,
    isMutation,
    hasVolatileFunctions
  };
}

/**
 * Generates a deterministic, collision-resistant cache key for a SQL query and its bound parameters.
 */
export function buildQueryCacheKey(
  normalizedSql: string,
  params: unknown[] | undefined,
  tables: string[],
  keyPrefix = 'ai'
): string {
  const serializedParams = params && params.length > 0 ? JSON.stringify(params) : '';
  const digest = crypto
    .createHash('sha256')
    .update(`${normalizedSql}::${serializedParams}`)
    .digest('hex')
    .slice(0, 24);

  const tableNamespace = tables.length > 0 ? tables.sort().join('+') : 'raw';
  return `${keyPrefix}:q:${tableNamespace}:${digest}`;
}
