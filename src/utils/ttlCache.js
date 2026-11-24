// Small in-process cache with a TTL and request coalescing: while a value is being loaded,
// concurrent callers share the same promise instead of each hitting the database.
// Only for shared, non-personal data.
class TtlCache {
    constructor({ ttlMs, maxEntries = 500 }) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.entries = new Map();
        this.loading = new Map();
        this.generation = 0;
    }

    async get(key, load) {
        const hit = this.entries.get(key);
        if (hit && hit.expires > Date.now()) return hit.value;
        if (this.loading.has(key)) return this.loading.get(key);

        const generation = this.generation;
        const promise = (async () => {
            const value = await load();
            // A write may have cleared the cache while this load was running
            if (generation === this.generation) this.set(key, value);
            return value;
        })();
        this.loading.set(key, promise);
        try {
            return await promise;
        } finally {
            if (this.loading.get(key) === promise) this.loading.delete(key);
        }
    }

    set(key, value) {
        this.entries.delete(key);
        this.entries.set(key, { value, expires: Date.now() + this.ttlMs });
        if (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
    }

    clear() {
        this.generation++;
        this.entries.clear();
        this.loading.clear();
    }
}

module.exports = TtlCache;
