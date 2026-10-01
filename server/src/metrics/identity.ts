import type { DiscoveredPost } from "./interface";

export function canonicalSyncIdentity(post: Pick<DiscoveredPost, "platform" | "platformPostId">): string {
  return `${post.platform}\u0000${post.platformPostId}`;
}

export function dedupeDiscoveredPosts(
  posts: DiscoveredPost[],
  seenIdentities: Set<string>,
): DiscoveredPost[] {
  const withinBatch = new Map<string, DiscoveredPost>();
  for (const post of posts) withinBatch.set(canonicalSyncIdentity(post), post);
  const unique: DiscoveredPost[] = [];
  for (const post of withinBatch.values()) {
    const identity = canonicalSyncIdentity(post);
    if (seenIdentities.has(identity)) continue;
    seenIdentities.add(identity);
    unique.push(post);
  }
  return unique;
}
