import assert from "node:assert/strict";
import test from "node:test";
import type { MetricsSyncScope } from "../interface";
import { InstagramMetricsProvider, normalizeInstagramContentType } from "./instagram";

const scope: MetricsSyncScope = {
  startDate: "2026-09-01",
  endDateExclusive: "2026-10-02",
  startTime: "2026-09-01T00:00:00.000Z",
  endTimeExclusive: "2026-10-02T00:00:00.000Z",
  timeZone: "UTC",
  platforms: ["ig"],
};

test("normalizes the Instagram API Reel response shape", () => {
  assert.equal(normalizeInstagramContentType("REELS", "VIDEO"), "Reel");
});

test("discovers a cross-posted Reel and follows Instagram pagination", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const body = calls === 1
      ? {
          data: [{
            id: "IG123",
            caption: "Caption X",
            media_type: "VIDEO",
            media_product_type: "REELS",
            media_url: "https://cdn.example.com/reel.mp4",
            thumbnail_url: "https://cdn.example.com/reel.jpg",
            permalink: "https://instagram.com/reel/IG123",
            timestamp: "2026-09-20T12:00:00+0000",
            like_count: 12,
            comments_count: 3,
          }],
          paging: { next: "https://graph.instagram.com/next-page" },
        }
      : { data: [], paging: {} };
    return new Response(JSON.stringify(body), { status: 200 });
  };

  const provider = new InstagramMetricsProvider("test-token", "test-user");
  const result = await provider.discoverPosts(scope);

  assert.equal(result.success, true);
  assert.equal(calls, 2);
  assert.equal(result.posts.length, 1);
  assert.deepEqual(result.posts[0], {
    platform: "ig",
    platformPostId: "IG123",
    publishedAt: "2026-09-20T12:00:00.000Z",
    contentType: "Reel",
    caption: "Caption X",
    mediaUrl: "https://cdn.example.com/reel.jpg",
    permalink: "https://instagram.com/reel/IG123",
    metrics: { likes: 12, comments: 3 },
  });
});
