// server/src/publish-runner.ts
// One-shot publishing worker for GitHub Actions.
// Queries due posts, publishes via existing platform publishers,
// updates Supabase, and exits cleanly.
// NEVER starts the HTTP server. NEVER listens on port 3001.

import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import dotenvConfig from "dotenv";
import { ensureClient } from "./lib/supabase";
import { logInfo, logError, logWarn } from "./lib/logger";
import { getDuePosts, updatePublishingResult, updatePublishingError } from "./posts";
import { routePublisher } from "./platforms/router";
import type { Post } from "./types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenvConfig.config({ path: path.join(__dirname, "..", ".env") });

// ── Config validation for Threads + Instagram-only worker ──

function validateConfig(): boolean {
  const required = [
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "THREADS_USER_ID",
    "THREAD_ACCESS_TOKEN",
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    logError(`Missing required environment variables: ${missing.join(", ")}`);
    return false;
  }
  logInfo("Publish runner configuration validated");
  return true;
}

// ── Publish one post ──

async function publishPost(post: Post): Promise<void> {
  logInfo(`Publishing due post`, { postId: post.id, platform: post.platform });

  const result = await routePublisher(post);

  if (result.success && result.platformPostId) {
    await updatePublishingResult(post.id, result.platformPostId, result.socialUrl ?? "");
    logInfo(`Post published successfully`, {
      postId: post.id,
      platformPostId: result.platformPostId,
      socialUrl: result.socialUrl,
    });
  } else {
    const errorMsg = result.error || "Publish returned no result";
    await updatePublishingError(post.id, errorMsg);
    logError(`Post publish failed`, { postId: post.id, error: errorMsg });
  }
}

// ── Main ──

async function main(): Promise<void> {
  // Ensure Supabase client is initialized before any query
  ensureClient();

  if (!validateConfig()) {
    process.exit(1);
  }

  logInfo("Starting one-shot publish runner");

  const duePosts = await getDuePosts();

  // Filter to Threads + Instagram only for this phase
  // Facebook posts are ignored during this phase
  const publishablePosts = duePosts.filter(
    (post) => post.platform === "th" || post.platform === "ig"
  );

  const skippedFacebook = duePosts.filter((post) => post.platform === "fb").length;
  if (skippedFacebook > 0) {
    logInfo(`Skipped ${skippedFacebook} Facebook post(s) — not processing in this phase`);
  }

  if (publishablePosts.length === 0) {
    logInfo("No due Threads or Instagram posts found.");
    process.exit(0);
  }

  logInfo(`Found ${publishablePosts.length} due post(s) to process`);

  for (const post of publishablePosts) {
    try {
      await publishPost(post);
    } catch (err: any) {
      logError(`Unexpected error processing post ${post.id}`, { error: err.message });
      await updatePublishingError(post.id, err.message || "Unexpected error");
    }
  }

  logInfo("Publish runner finished.");
  process.exit(0);
}

main().catch((err: any) => {
  logError("Publish runner fatal error", { error: err.message });
  process.exit(1);
});
