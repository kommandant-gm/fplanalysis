function createResponseCache(ttlMs = 45_000, maxEntries = 800) {
  const store = new Map();

  function pruneExpired(now = Date.now()) {
    for (const [key, value] of store.entries()) {
      if (value.expiresAt <= now) store.delete(key);
    }
  }

  function trimOverflow() {
    if (store.size <= maxEntries) return;
    const overflow = store.size - maxEntries;
    const keys = store.keys();
    for (let i = 0; i < overflow; i++) {
      const k = keys.next().value;
      if (k === undefined) break;
      store.delete(k);
    }
  }

  const middleware = (req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.query?.nocache === '1') return next();

    const key = req.originalUrl;
    const now = Date.now();
    const hit = store.get(key);

    if (hit && hit.expiresAt > now) {
      res.set('X-Cache', 'HIT');
      return res.status(hit.status).json(hit.body);
    }

    if (hit) store.delete(key);
    pruneExpired(now);

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      if (status >= 200 && status < 300) {
        store.set(key, {
          status,
          body,
          expiresAt: Date.now() + ttlMs,
        });
        trimOverflow();
      }
      res.set('X-Cache', 'MISS');
      return originalJson(body);
    };

    return next();
  };

  middleware.clear = () => {
    store.clear();
  };

  middleware.stats = () => ({
    entries: store.size,
    ttlMs,
    maxEntries,
  });

  return middleware;
}

module.exports = { createResponseCache };
