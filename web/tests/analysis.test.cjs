const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, imports = {}) {
  const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../src/lib", file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(js, { module, exports: module.exports, require: name => imports[name], Date, Map, Set, Intl, URL });
  return module.exports;
}
const a = load("analysis.ts");
const post = (id, changes = {}) => ({ id, platform: "ig", contentType: "Reel", status: "published", publishedAt: "2026-10-03T10:00:00Z", date: "2000-01-01", time: "00:00", views: 100, likes: 5, comments: 2, shares: 3, ...changes });
const filters = { platform: "all", contentType: "all", range: "all", start: "", end: "" };

test("median handles odd/even counts, null values and empty data", () => {
  assert.equal(a.median([9, 1, 4]), 4);
  assert.equal(a.median([10, null, 2, 4, 8]), 6);
  assert.equal(a.median([null, undefined]), null);
  assert.equal(a.median([0]), 0);
});
test("engagement totals available metrics and distinguishes null from zero", () => {
  assert.equal(a.engagement(post("1")), 10);
  assert.equal(a.engagement(post("yt", { platform: "yt", shares: 123 })), 7);
  assert.equal(a.metric(post("yt", { platform: "yt" }), "shares"), null);
  assert.equal(a.engagement(post("0", { likes: 0, comments: 0, shares: null })), 0);
  assert.equal(a.engagement(post("na", { likes: null, comments: null, shares: null })), null);
  assert.equal(a.engagementRate(0, 100), 0);
  assert.equal(a.engagementRate(10, 0), null);
  assert.equal(a.engagementRate(null, 100), null);
  const summary = a.summarize([post("1"), post("2", { platform: "yt", shares: null })]);
  assert.equal(summary.engagements.total, 17);
  assert.equal(summary.avgShares, 3);
  assert.equal(summary.shares.available, 1);
  assert.equal(summary.partial, true);
  assert.equal(a.summarize([post("yt", { platform: "yt" })]).shares.total, null);
});
test("Performance Index uses filtered platform + content type median and minimum sample", () => {
  const posts = Array.from({ length: 5 }, (_, i) => post(String(i), { views: (i + 1) * 100 }));
  const cohort = a.cohorts(posts)[0];
  assert.equal(a.performanceIndex(posts[2], cohort), 1);
  assert.equal(a.performanceIndex(posts[4], cohort), 5 / 3);
  assert.equal(a.performanceIndex(posts[0], a.summarize(posts.slice(0, 4))), null);
  assert.equal(a.performanceIndex(posts[0], a.summarize(posts.map(p => ({ ...p, views: 0 })))), null);
  assert.equal(a.performanceIndex(posts[0], a.summarize(posts.map(p => ({ ...p, views: null })))), null);
  assert.equal(a.cohorts([...posts, post("other", { platform: "fb" }), post("image", { contentType: "Image" })]).length, 3);
});
test("filters use published_at only, inclusive local dates, and published status", () => {
  const pool = [post("valid"), post("draft", { status: "draft" }), post("missing", { publishedAt: null }), post("invalid", { publishedAt: "invalid" }), post("old", { publishedAt: "2026-09-01T00:00:00Z", date: "2026-10-03" })];
  const range = { ...filters, range: "custom", start: "2026-10-03", end: "2026-10-03" };
  assert.equal(a.filterAnalysisPosts(pool, range, "Asia/Calcutta").length, 1);
  assert.equal(a.filterAnalysisPosts(pool, { ...filters, platform: "yt" }, "UTC").length, 0);
  assert.equal(a.filterAnalysisPosts(pool, { ...range, start: "2026-10-04" }, "UTC").length, 0);
  const boundary = post("boundary", { publishedAt: "2026-10-02T20:00:00Z" });
  assert.equal(a.filterAnalysisPosts([boundary], range, "Asia/Calcutta").length, 1);
  assert.equal(a.filterAnalysisPosts([boundary], range, "UTC").length, 0);
  assert.equal(a.filterAnalysisPosts([post("first", { publishedAt: "2026-09-27T00:00:00Z" }), post("before", { publishedAt: "2026-09-26T23:59:59Z" })], { ...filters, range: "7d" }, "UTC", new Date("2026-10-03T12:00:00Z")).length, 1);
});
test("weekday/hour derive from actual publication time in the selected timezone", () => {
  const parts = a.publicationParts("2026-10-02T20:00:00Z", "Asia/Calcutta");
  assert.equal(parts.date, "2026-10-03");
  assert.equal(parts.weekday, 5);
  assert.equal(parts.hour, 1);
});
test("numeric sorting places N/A after zero and real values", () => {
  const pool = [post("na", { shares: null }), post("zero", { shares: 0 }), post("real", { shares: 12 })];
  assert.equal(a.sortPosts(pool, "shares", new Map()).map(p => p.id).join(), "real,zero,na");
  assert.equal(a.compareNullable(null, 0, false), 1);
  assert.equal(a.sortPosts(pool, "index", new Map([["real", 2], ["zero", 0]])).map(p => p.id).join(), "real,zero,na");
});
test("timeline groups cumulative performance by publication, not sync time", () => {
  const result = a.timeline([post("1"), post("2", { publishedAt: "2026-10-05T00:00:00Z" })], "UTC");
  assert.equal(result.grouping, "day");
  assert.equal(result.views[0].value, 100);
  assert.equal(result.views[1].value, 0);
  assert.equal(result.posts[2].value, 1);
});
test("existing paginated repository fetches >1000 posts without snapshots and preserves nulls", async () => {
  const rows = Array.from({ length: 1203 }, (_, i) => ({ id: String(i), platform: i === 0 ? "yt" : "ig", content_type: "Reel", status: "published", published_at: "2026-10-03T00:00:00Z", views: i === 1 ? null : 0, likes: 0, comments: 0, shares: i === 2 ? null : 0 }));
  const ranges = [], selections = [], tables = [];
  const supabase = { from(table) { tables.push(table); const query = { select(value) { selections.push(value); return query; }, order() { return query; }, range(from, to) { ranges.push([from, to]); return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); } }; return query; } };
  const api = load("supabasePosts.ts", { "./supabase": { supabase }, "./validation": { normalizePost: p => p } });
  const posts = await api.fetchPosts();
  assert.equal(posts.length, 1203);
  assert.equal(ranges.length, 3);
  assert.ok(tables.every(t => t === "posts"));
  assert.ok(selections.every(s => s === "*"));
  assert.equal(posts[0].shares, null);
  assert.equal(posts[1].views, null);
  assert.equal(posts[2].shares, null);
  assert.equal(posts[3].shares, 0);
  assert.equal(a.filterAnalysisPosts(posts, filters, "UTC").length, 1203);
});
