// server/src/platforms/publishers/interface.ts
// Generic publisher interface for all platforms.

import type { Post } from "../../types";

export interface PublishResult {
  success: boolean;
  platformPostId?: string | null;
  socialUrl?: string | null;
  error?: string | null;
  testMode?: boolean;
  // For scheduled posts — the post is scheduled, not yet published
  isScheduled?: boolean;
}

export interface PlatformPublisher {
  publish(post: Post): Promise<PublishResult>;
}
