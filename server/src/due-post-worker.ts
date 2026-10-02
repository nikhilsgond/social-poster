import { logError, logInfo, logWarn } from "./lib/logger";
import {
  claimDuePostForPublishing,
  getDuePosts,
  updatePublishingError,
  updatePublishingResult,
} from "./posts";
import { routePublisher } from "./platforms/router";

export interface DuePostWorkerResult {
  ok: true;
  due: number;
  published: number;
  failed: number;
}

export async function runDuePostWorker(): Promise<DuePostWorkerResult> {
  const duePosts = await getDuePosts();
  let published = 0;
  let failed = 0;

  for (const duePost of duePosts) {
    const claimedPost = await claimDuePostForPublishing(duePost.id);
    if (!claimedPost) {
      logWarn("Due post was already claimed or is no longer due", { postId: duePost.id });
      continue;
    }

    try {
      const result = await routePublisher(claimedPost);
      if (result.success && result.platformPostId) {
        await updatePublishingResult(
          claimedPost.id,
          result.platformPostId,
          result.socialUrl ?? "",
        );
        published += 1;
        continue;
      }

      await updatePublishingError(
        claimedPost.id,
        result.error || "Publish returned no platform post ID",
        result.platformPostId,
      );
      failed += 1;
    } catch (err: any) {
      const message = err?.message || "Unexpected publishing error";
      logError("Unexpected due-post publishing error", { postId: claimedPost.id, error: message });
      try {
        await updatePublishingError(claimedPost.id, message);
      } catch (updateErr: any) {
        logError("Could not mark due post as failed", {
          postId: claimedPost.id,
          error: updateErr?.message || "Unknown database error",
        });
      }
      failed += 1;
    }
  }

  const summary: DuePostWorkerResult = {
    ok: true,
    due: duePosts.length,
    published,
    failed,
  };
  logInfo("Due-post worker finished", { ...summary });
  return summary;
}
