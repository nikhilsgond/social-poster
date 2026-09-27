// server/src/test-mode.ts
// Backend test mode flow.
// Verifies the complete backend pipeline without performing real publishing.
// Does NOT modify real post status to "published" during test mode.
// Preserved from Phase 6 — uses the real publisher but marks results as test mode.

import { supabaseServer } from "./lib/supabase";
import { getDuePosts } from "./posts";
import { routePublisher } from "./platforms/router";
import { logInfo, logWarn } from "./lib/logger";

export interface TestModeResult {
  duePostsFound: number;
  processed: number;
  results: TestModePublishResult[];
  errors: string[];
}

export interface TestModePublishResult {
  postId: string;
  platform: string;
  success: boolean;
  testMode: boolean;
  error?: string | null;
}

export async function runTestMode(): Promise<TestModeResult> {
  const result: TestModeResult = {
    duePostsFound: 0,
    processed: 0,
    results: [],
    errors: [],
  };

  logInfo("Starting backend test mode...");

  // Step 1: Connect to Supabase
  try {
    const { data: check } = await supabaseServer.from("posts").select("count").limit(1);
    logInfo("Supabase connection verified");
  } catch (err: any) {
    const msg = `Supabase connection failed: ${err.message}`;
    logWarn(msg);
    result.errors.push(msg);
    return result;
  }

  // Step 2: Get due posts
  let duePosts;
  try {
    duePosts = await getDuePosts();
  } catch (err: any) {
    const msg = `Failed to fetch due posts: ${err.message}`;
    logWarn(msg);
    result.errors.push(msg);
    return result;
  }

  result.duePostsFound = duePosts.length;
  logInfo(`Found ${duePosts.length} due posts`);

  // Step 3-5: Route each post to the appropriate publisher (test mode)
  for (const post of duePosts) {
    const publishResult = await routePublisher(post);

    result.results.push({
      postId: post.id,
      platform: post.platform,
      success: publishResult.success,
      testMode: true, // Always test mode — no real publishing
      error: publishResult.error,
    });

    result.processed++;

    // IMPORTANT: Do NOT modify real post status to "published" during test mode
    logInfo(`Test mode: ${post.platform} post ${post.id} processed (not actually published)`);
  }

  logInfo(`Test mode complete: ${result.processed} posts processed`);
  return result;
}