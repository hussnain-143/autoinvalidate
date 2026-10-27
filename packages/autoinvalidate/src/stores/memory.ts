import type { CacheStore, StoredCachePayload } from '../types.js';

export interface MemoryCacheStoreOptions {
  /**
   * Maximum number of cached queries to keep in memory (LRU eviction). Default: 2000.
   */
  maxEntries?: number;
}

export class MemoryCacheStore implements CacheStore {
  private readonly maxEntries: number;
  private readonly entries = new Map<string, StoredCachePayload<any>>();
  private readonly tagIndex = new Map<string, Set<string>>();

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 2000;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.entries.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.deleteKeyInternal(key, entry.tags);
      return null;
    }

    // Refresh LRU order
    this.entries.delete(key);
    this.entries.set(key, entry);

    return structuredClone(entry.data) as T;
  }

  async set<T = unknown>(key: string, value: T, tags: string[], ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;

    // If key exists, clean up old tag mappings
    const existing = this.entries.get(key);
    if (existing) {
      this.deleteKeyInternal(key, existing.tags);
    }

    // Enforce maxEntries via LRU eviction
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      const oldestEntry = this.entries.get(oldestKey);
      this.deleteKeyInternal(oldestKey, oldestEntry?.tags ?? []);
    }

    const now = Date.now();
    const payload: StoredCachePayload<T> = {
      data: structuredClone(value),
      tags,
      createdAt: now,
      expiresAt: now + ttlMs
    };

    this.entries.set(key, payload);

    for (const tag of tags) {
      let keySet = this.tagIndex.get(tag);
      if (!keySet) {
        keySet = new Set<string>();
        this.tagIndex.set(tag, keySet);
      }
      keySet.add(key);
    }
  }

  async invalidateTags(tags: string[]): Promise<number> {
    const keysToDelete = new Set<string>();

    for (const tag of tags) {
      const taggedKeys = this.tagIndex.get(tag);
      if (taggedKeys) {
        for (const key of taggedKeys) {
          keysToDelete.add(key);
        }
        this.tagIndex.delete(tag);
      }
    }

    let deletedCount = 0;
    for (const key of keysToDelete) {
      const entry = this.entries.get(key);
      if (entry) {
        this.deleteKeyInternal(key, entry.tags);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  async clear(): Promise<void> {
    this.entries.clear();
    this.tagIndex.clear();
  }

  /**
   * Returns current number of cached queries and active tags (useful for diagnostics).
   */
  getSize(): { entries: number; tags: number } {
    return {
      entries: this.entries.size,
      tags: this.tagIndex.size
    };
  }

  private deleteKeyInternal(key: string, tags: string[]): void {
    this.entries.delete(key);
    for (const tag of tags) {
      const set = this.tagIndex.get(tag);
      if (set) {
        set.delete(key);
        if (set.size === 0) {
          this.tagIndex.delete(tag);
        }
      }
    }
  }
}

