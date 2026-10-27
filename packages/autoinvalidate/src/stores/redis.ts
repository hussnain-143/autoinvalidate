import type { CacheStore } from '../types.js';

/**
 * Universal Redis client interface compatible with:
 * - `ioredis` (v5+)
 * - `redis` / `node-redis` (v4+)
 * - `@upstash/redis`
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null | unknown>;
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: any[]): Promise<number>;
  // ioredis methods (lowercase)
  sadd?(key: string, ...members: any[]): Promise<number>;
  smembers?(key: string): Promise<string[]>;
  pexpire?(key: string, milliseconds: number): Promise<number>;
  // node-redis v4 methods (camelCase)
  sAdd?(key: string, members: string | string[]): Promise<number>;
  sMembers?(key: string): Promise<string[]>;
  pExpire?(key: string, milliseconds: number): Promise<number | boolean>;
}

export interface RedisCacheStoreOptions {
  /**
   * Prefix for tag index sets in Redis. Default: 'ai:tag'.
   */
  tagPrefix?: string;
}

export class RedisCacheStore implements CacheStore {
  private readonly redis: RedisLikeClient;
  private readonly tagPrefix: string;
  private readonly knownTagKeys = new Set<string>();

  constructor(redisClient: RedisLikeClient, options: RedisCacheStoreOptions = {}) {
    if (!redisClient) {
      throw new Error('[autoinvalidate] RedisCacheStore requires a valid Redis client instance (ioredis or redis).');
    }
    this.redis = redisClient;
    this.tagPrefix = options.tagPrefix ?? 'ai:tag';
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const raw = await this.redis.get(key);
    if (raw === null || raw === undefined) return null;
    if (typeof raw === 'object') return raw as T;
    if (typeof raw !== 'string') return null;

    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T = unknown>(key: string, value: T, tags: string[], ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;

    const serialized = JSON.stringify(value);

    // Compatible with both node-redis v4 (`set(k, v, { PX: ttlMs })`) and ioredis (`set(k, v, 'PX', ttlMs)`)
    await this.setWithTtl(key, serialized, ttlMs);

    // Index the cache key under each tag's Redis Set
    for (const tag of tags) {
      const tagKey = this.formatTagKey(tag);
      this.knownTagKeys.add(tagKey);
      await this.saddMember(tagKey, key);
      // Keep the tag set alive slightly longer than the query TTL
      await this.pexpireKey(tagKey, ttlMs + 60_000);
    }
  }

  async invalidateTags(tags: string[]): Promise<number> {
    if (tags.length === 0) return 0;

    const tagKeys = tags.map((t) => this.formatTagKey(t));
    const keysToDelete = new Set<string>();

    for (const tagKey of tagKeys) {
      const members = await this.smembersKey(tagKey);
      for (const member of members) {
        keysToDelete.add(member);
      }
      this.knownTagKeys.delete(tagKey);
    }

    const allKeysToRemove = [...Array.from(keysToDelete), ...tagKeys];
    if (allKeysToRemove.length > 0) {
      await this.deleteKeys(allKeysToRemove);
    }

    return keysToDelete.size;
  }

  async clear(): Promise<void> {
    const tagKeys = Array.from(this.knownTagKeys);
    if (tagKeys.length > 0) {
      const tags = tagKeys.map((tk) => tk.slice(this.tagPrefix.length + 1));
      await this.invalidateTags(tags);
    }
  }

  private formatTagKey(tag: string): string {
    return `${this.tagPrefix}:${tag}`;
  }

  private async setWithTtl(key: string, value: string, ttlMs: number): Promise<void> {
    // Detect node-redis v4 vs ioredis
    if (typeof this.redis.sAdd === 'function' && typeof this.redis.sadd !== 'function') {
      await this.redis.set(key, value, { PX: ttlMs });
    } else {
      try {
        await this.redis.set(key, value, 'PX', ttlMs);
      } catch {
        await this.redis.set(key, value, { PX: ttlMs });
      }
    }
  }

  private async saddMember(tagKey: string, member: string): Promise<void> {
    if (typeof this.redis.sadd === 'function') {
      await this.redis.sadd(tagKey, member);
    } else if (typeof this.redis.sAdd === 'function') {
      await this.redis.sAdd(tagKey, member);
    }
  }

  private async smembersKey(tagKey: string): Promise<string[]> {
    if (typeof this.redis.smembers === 'function') {
      return (await this.redis.smembers(tagKey)) ?? [];
    }
    if (typeof this.redis.sMembers === 'function') {
      return (await this.redis.sMembers(tagKey)) ?? [];
    }
    return [];
  }

  private async pexpireKey(key: string, ttlMs: number): Promise<void> {
    if (typeof this.redis.pexpire === 'function') {
      await this.redis.pexpire(key, ttlMs);
    } else if (typeof this.redis.pExpire === 'function') {
      await this.redis.pExpire(key, ttlMs);
    }
  }

  private async deleteKeys(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    // node-redis v4 accepts string[] or varargs; ioredis accepts varargs
    if (typeof this.redis.sAdd === 'function' && typeof this.redis.sadd !== 'function') {
      await this.redis.del(keys);
    } else {
      await this.redis.del(...keys);
    }
  }
}

