const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const post = (id, status = "published", changes = {}) => ({ id, status, platform: "ig", contentType: "Image",
  date: "2025-01-01", time: "10:00", createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z", title: `Post ${id}`, mediaUrl: "https://example.com/image.png", ...changes });

function loadModule(file, imports) {
  const source = fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: (name) => imports[name], Date, Map, Promise, navigator: {} });
  return module.exports;
}

function fixture(initialRows = []) {
  let records = initialRows;
  let cached = new Map();
  let metadata;
  const calls = [];
  const failures = { read: false, write: false, live: false };
  const cache = {
    async getPostsCacheSnapshot() { if (failures.read) throw Error("Storage blocked"); return { posts: [...cached.values()], metadata }; },
    isValidPostsCache: (snapshot) => snapshot.metadata?.initialized && snapshot.metadata.publishedCount === snapshot.posts.length,
    createPostsCacheMetadata: (watermark) => ({ initialized: true, watermark, publishedCount: 0 }),
    async clearPostsCache() { if (failures.write) throw Error("Storage blocked"); cached.clear(); metadata = undefined; },
    async upsertCachedPosts(posts, nextMetadata, replace) {
      if (failures.write) throw Error("Storage blocked");
      if (replace) cached.clear();
      for (const row of posts) row.status === "published" ? cached.set(row.id, { ...row }) : cached.delete(row.id);
      metadata = nextMetadata || metadata;
      if (metadata) metadata = { ...metadata, publishedCount: cached.size };
    },
    async removeCachedPost(id) { if (failures.write) throw Error("Storage blocked"); cached.delete(id); if (metadata) metadata = { ...metadata, publishedCount: cached.size }; },
  };
  const repository = { async fetchPosts(options) {
    calls.push(options);
    if (failures.live) throw Error("Network failed");
    return records.filter((row) => {
      if (options.scope) return options.scope.platforms.includes(row.platform) && (!options.scope.startDate || row.date >= options.scope.startDate)
        && (!options.scope.endDateExclusive || row.date < options.scope.endDateExclusive);
      return !options.changedSince || row.status !== "published" || [row.createdAt, row.updatedAt, row.publishedAt, row.metricsUpdatedAt]
        .some((value) => value && Date.parse(value) >= Date.parse(options.changedSince));
    });
  } };
  const api = loadModule("postsLoading.ts", { "./supabasePosts": repository, "./postsCache": cache });
  return { api, cache, calls, failures, get cached() { return cached; }, get metadata() { return metadata; },
    set records(value) { records = value; } };
}

test("initializes full published history; later loads request active/recent changes only", async () => {
  const old = Array.from({ length: 1100 }, (_, index) => post(String(index)));
  const active = post("active", "scheduled");
  const f = fixture([...old, active]);
  const first = await f.api.loadPostsWithCache();
  assert.equal(first.posts.length, 1101);
  assert.equal(f.cached.size, 1100);
  assert.equal(f.calls[0].changedSince, undefined);
  const firstWatermark = f.metadata.watermark;
  const published = post("active", "published", { publishedAt: new Date().toISOString() });
  f.records = [...old, published, post("draft", "draft")];
  let shown;
  const next = await f.api.loadPostsWithCache((posts) => { shown = posts; });
  assert.equal(shown.length, 1100);
  assert.equal(f.calls[1].changedSince, new Date(Date.parse(firstWatermark) - 300000).toISOString());
  assert.equal(next.posts.length, 1102);
  assert.equal(f.cached.get("active").status, "published");
  assert.equal(new Set(next.posts.map((row) => row.id)).size, next.posts.length);
  assert.equal(f.cached.get("1").title, "Post 1");
  assert.equal(f.cached.get("1").mediaUrl, "https://example.com/image.png");
});

test("scoped Sync refreshes metrics and shares without advancing the global watermark", async () => {
  const f = fixture([post("old"), post("other", "published", { platform: "fb" })]);
  await f.api.loadPostsWithCache();
  const watermark = f.metadata.watermark;
  f.records = [post("old", "published", { views: 321, likes: 22, comments: 6, shares: 11 }), post("other", "published", { platform: "fb" })];
  const scope = { platforms: ["ig"], startDate: "2025-01-01", endDateExclusive: "2025-02-01" };
  const result = await f.api.refreshScopedPosts(scope);
  assert.equal(result.posts.length, 1);
  assert.equal(f.calls.at(-1).scope, scope);
  assert.equal(f.cached.get("old").views, 321);
  assert.equal(f.cached.get("old").shares, 11);
  assert.equal(f.metadata.watermark, watermark);
  assert.equal(f.cached.size, 2);
});

test("published updates, active transitions and deletion keep cache identities consistent", async () => {
  const f = fixture([post("one")]);
  await f.api.loadPostsWithCache();
  assert.equal(await f.api.cachePostChanges([post("one", "published", { title: "Changed" })]), true);
  assert.equal(f.cached.get("one").title, "Changed");
  await f.api.cachePostChanges([post("one", "draft")]);
  assert.equal(f.cached.has("one"), false);
  await f.api.cachePostChanges([post("two")]);
  await f.api.cachePostChanges([], "two");
  assert.equal(f.cached.size, 0);
  assert.equal(f.metadata.publishedCount, 0);
});

test("incremental failures retain historical data and do not advance or wipe a valid cache", async () => {
  const f = fixture([post("cached")]);
  await f.api.loadPostsWithCache();
  const metadata = f.metadata;
  f.failures.live = true;
  const result = await f.api.loadPostsWithCache();
  assert.equal(result.posts[0].id, "cached");
  assert.ok(result.error);
  assert.equal(f.metadata, metadata);
  assert.equal(f.cached.size, 1);
});

test("unavailable/corrupt storage falls back to full Supabase loading", async () => {
  const f = fixture([post("one"), post("draft", "draft")]);
  f.failures.read = true;
  f.failures.write = true;
  const result = await f.api.loadPostsWithCache();
  assert.equal(result.posts.length, 2);
  assert.equal(result.cacheUnavailable, true);
  assert.equal(f.calls[0].changedSince, undefined);
  assert.equal(await f.api.cachePostChanges([post("one")]), false);
  f.failures.read = false;
  f.failures.write = false;
  await f.api.loadPostsWithCache();
  assert.equal(f.cached.size, 1);
  // Missing records invalidate the count and force a rebuild.
  f.cached.clear();
  await f.api.loadPostsWithCache();
  assert.equal(f.calls.at(-1).changedSince, undefined);
  assert.equal(f.cached.size, 1);
});

test("explicit rebuild fetches full history and removes obsolete cached rows", async () => {
  const f = fixture([post("removed"), post("kept")]);
  await f.api.loadPostsWithCache();
  f.records = [post("kept"), post("new-active", "failed")];
  const result = await f.api.loadPostsWithCache(undefined, true);
  assert.equal(f.calls.at(-1).changedSince, undefined);
  assert.equal(f.cached.has("removed"), false);
  assert.equal(result.posts.length, 2);
});

test("repository pagination and incremental/scoped filters preserve metadata", async () => {
  const queries = [];
  const rows = Array.from({ length: 1103 }, (_, i) => ({ id: String(i), platform: "ig", status: "published", content_type: "Image",
    date: "2025-01-01", time: "10:00", updated_at: "2026-10-02T00:00:00.000Z", metrics_updated_at: "2026-10-02T01:00:00.000Z",
    shares: 19, views: 60 }));
  const supabase = { from(table) {
    const query = { table, filters: [] };
    queries.push(query);
    const chain = { select(value) { query.select = value; return chain; }, order() { return chain; }, limit() { return chain; },
      range(start, end) { query.range = [start, end]; return chain; }, or(value) { query.filters.push(value); return chain; },
      in(field, value) { query.platforms = value; return chain; }, gte() { return chain; }, lt() { return chain; },
      then(resolve) { resolve({ data: rows.slice(query.range[0], query.range[1] + 1), error: null }); } };
    return chain;
  } };
  const repository = loadModule("supabasePosts.ts", { "./supabase": { supabase }, "./validation": {
    normalizePost: (p) => { const value = { ...p }; delete value.metricsUpdatedAt; return value; }, buildScheduledAt() {} } });
  const fetched = await repository.fetchPosts({ changedSince: "2026-10-01T00:00:00.000Z" });
  assert.equal(fetched.length, 1103);
  assert.deepEqual(queries.map((q) => q.range), [[0, 499], [500, 999], [1000, 1499]]);
  assert.match(queries[0].filters[0], /status.neq.published/);
  assert.match(queries[0].filters[0], /published_at.gte/);
  assert.match(queries[0].filters[0], /metrics_updated_at.gte/);
  assert.equal(fetched[0].shares, 19);
  assert.equal(fetched[0].metricsUpdatedAt, rows[0].metrics_updated_at);
  queries.length = 0;
  await repository.fetchPosts({ scope: { platforms: ["ig"], startDate: "2025-01-01", endDateExclusive: "2025-02-01",
    startTime: "2025-01-01T00:00:00.000Z", endTimeExclusive: "2025-02-01T00:00:00.000Z" } });
  assert.deepEqual(queries[0].platforms, ["ig"]);
  assert.match(queries[0].filters[0], /published_at.is.null,date.gte.2025-01-01/);
});
