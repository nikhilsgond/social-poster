import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveredPost } from "./interface";
import { canonicalSyncIdentity, dedupeDiscoveredPosts } from "./identity";

function discovered(platform: DiscoveredPost["platform"], platformPostId: string, caption: string, contentType = "Post"): DiscoveredPost {
  return {
    platform,
    platformPostId,
    publishedAt: "2026-06-01T12:00:00.000Z",
    contentType,
    caption,
  };
}

test("same caption on Instagram, Facebook, and Threads remains three identities", () => {
  const caption = "Learn this Excel trick...";
  const posts = [
    discovered("ig", "IG123", caption, "Reel"),
    discovered("fb", "FB456", caption, "Reel"),
    discovered("th", "TH789", caption, "Video"),
  ];

  assert.equal(new Set(posts.map(canonicalSyncIdentity)).size, 3);
  assert.equal(dedupeDiscoveredPosts(posts, new Set()).length, 3);
});

test("same platform and platform post ID reconciles as one identity", () => {
  const first = discovered("ig", "IG123", "Original caption");
  const refreshed = discovered("ig", "IG123", "Updated caption");

  assert.equal(canonicalSyncIdentity(first), canonicalSyncIdentity(refreshed));
  assert.deepEqual(dedupeDiscoveredPosts([first, refreshed], new Set()), [refreshed]);
});

test("same caption with different IDs on one platform remains separate", () => {
  const caption = "5 Excel formulas you should know";
  const posts = [
    discovered("ig", "IG_JAN", caption),
    discovered("ig", "IG_JUN", caption),
  ];

  assert.equal(dedupeDiscoveredPosts(posts, new Set()).length, 2);
});

test("a bare provider ID cannot match across platforms", () => {
  const instagram = discovered("ig", "123", "Shared caption");
  const facebook = discovered("fb", "123", "Shared caption");

  assert.notEqual(canonicalSyncIdentity(instagram), canonicalSyncIdentity(facebook));
});

test("repeated pages do not reprocess an existing canonical identity", () => {
  const seen = new Set<string>();
  const post = discovered("th", "TH789", "Caption");

  assert.equal(dedupeDiscoveredPosts([post], seen).length, 1);
  assert.equal(dedupeDiscoveredPosts([post], seen).length, 0);
});
