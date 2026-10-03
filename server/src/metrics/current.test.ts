import { test } from "node:test";
import assert from "node:assert/strict";
import { currentMetrics } from "./current";
import { mapFacebookPostCounts, FacebookMetricsProvider } from "./providers/facebook";
import { YouTubeMetricsProvider } from "./providers/youtube";
import { mergeMetrics } from "./providers/shared";

test("current metrics preserve API zero, explicit null and omitted refreshes", () => {
  const result = currentMetrics("ig", { views: 0, likes: null, shares: 123 }, { views: 40, likes: 10, comments: 8, shares: 5 });
  assert.deepEqual(result, { views: 0, likes: null, comments: 8, shares: 123 });
  assert.equal(currentMetrics("yt", { shares: 999 }).shares, null);
  assert.equal(currentMetrics("ig", {}).shares, null);
  assert.equal(mergeMetrics({ shares: 20 }, { shares: null }).shares, null);
});

test("Facebook discovery requests ALL reactions and maps combined count", async () => {
  const originalFetch = globalThis.fetch;
  let request = "";
  globalThis.fetch = (async (url: any) => { request = String(url); return { ok: true, text: async () => JSON.stringify({ data: [{ id: "fb1", created_time: "2026-10-03T10:00:00Z", reactions: { summary: { total_count: 37 } }, comments: { summary: { total_count: 0 } }, shares: { count: 4 } }] }) } as any; }) as any;
  try {
    const result = await new FacebookMetricsProvider("token", "page").discoverPosts({ allHistory: true, endTimeExclusive: "2026-10-04T00:00:00Z", startDate: "", endDateExclusive: "", startTime: "", timeZone: "UTC" });
    assert.match(decodeURIComponent(request), /reactions.limit\(0\).summary\(true\)/);
    assert.doesNotMatch(request, /type.*LIKE/);
    assert.equal(result.posts[0].metrics?.likes, 37);
    assert.equal(result.posts[0].metrics?.comments, 0);
    assert.equal(mapFacebookPostCounts({}).likes, undefined);
  } finally { globalThis.fetch = originalFetch; }
});

test("YouTube metric response always marks shares unavailable, preserves real zero", async () => {
  const provider = new YouTubeMetricsProvider();
  (provider as any).request = async () => ({ items: [{ statistics: { viewCount: "0", likeCount: "123" } }] });
  const result = await provider.fetchMetrics({ id: "id", platformPostId: "video" } as any);
  assert.deepEqual(result.metrics, { views: 0, likes: 123, comments: null, shares: null });
});
