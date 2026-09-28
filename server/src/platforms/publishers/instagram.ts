// server/src/platforms/publishers/instagram.ts
// Real Instagram publisher.
// Uses the Instagram Graph API client to publish image, video, reel,
// story, and carousel posts.
// The Instagram client (src/lib/instagram.ts) is completely isolated from the
// Threads client (src/lib/threads.ts) and Facebook client (src/lib/facebook.ts).
// Separate host, endpoints, parameters, tokens, and error types.
// Respects the existing scheduled_at scheduling semantics.
// Never logs the access token.
//
// Media URLs must be publicly accessible — Meta cURLs the URL from the server.
// Private URLs (Google Drive, localhost, etc.) will fail.
// Stories use media_type=STORIES and support image_url or video_url
// based on the Post content type (not URL extension).
// Stories expire after 24 hours. No interactive stickers via API.
// Video Stories are validated against the official 8MB limit before container creation.

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import {
  InstagramGraphClient,
  validateStoryMedia,
} from "../../lib/instagram";
import { logInfo, logWarn, logError } from "../../lib/logger";

// ── Instagram media_type mapping ──
// Social Planner uses internal content types (e.g. "Image", "Video", "Carousel").
// Instagram API requires: IMAGE, VIDEO, REELS, CAROUSEL_ALBUM, STORIES.
// This mapping validates and converts the planner type to the Instagram API type.
// Unsupported values throw a local error before calling the API.
// Stories use media_type=STORIES and support image_url or video_url.

function mapToInstagramMediaType(contentType: string | undefined): string {
  const upper = (contentType || "").toUpperCase();
  switch (upper) {
    case "IMAGE":
      return "IMAGE";
    case "VIDEO":
      return "VIDEO";
    case "REELS":
    case "REEL":
      return "REELS";
    case "CAROUSEL_ALBUM":
    case "CAROUSEL":
      return "CAROUSEL_ALBUM";
    case "STORY":
    case "STORIES":
      // Ambiguous — rejected by validateStoryMedia at publish time
      return "STORIES";
    case "STORY_IMAGE":
    case "STORYIMAGE":
      return "STORIES"; // image Story (isVideoStory = false)
    case "STORY_VIDEO":
    case "STORYVIDEO":
      return "STORIES"; // video Story (isVideoStory = true)
    default:
      throw new Error(
        `Unsupported Instagram content type: ${contentType || "(empty)"}`
      );
  }
}

export class InstagramPublisher implements PlatformPublisher {
  private client: InstagramGraphClient;

  constructor(userId: string, accessToken: string) {
    this.client = new InstagramGraphClient({ userId, accessToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`Instagram publish received`, { postId: post.id, platform: post.platform });

    // Validate required fields — Instagram requires media (image or video)
    if (!post.mediaUrl && !post.content) {
      logError("Instagram publish failed: no content or media URL");
      return { success: false, error: "No content or media URL provided" };
    }

    const scheduledAt = post.scheduledAt;
    const isScheduled = scheduledAt && new Date(scheduledAt) > new Date();

    if (isScheduled) {
      logInfo(`Instagram post ${post.id} is scheduled for ${scheduledAt} — not yet due`);
      return { success: false, error: "Post is scheduled and not yet due", isScheduled: true };
    }

    try {
      // Determine content type — map Social Planner contentType to Instagram API media_type
      const instagramMediaType = mapToInstagramMediaType(post.contentType);
      const caption = post.caption || post.content || "";

      // For carousels, extract child container IDs from the post data if available
      const children = post.carouselChildren ?? [];

      // Step 0: Validate Story media before creating container
      // For video Stories, enforce the official 8MB size limit
      // For image Stories, just ensure a valid mediaUrl exists
      let isVideoStory: boolean | undefined;
      if (instagramMediaType === "STORIES") {
        const validation = await validateStoryMedia(
          post.mediaUrl ?? undefined,
          post.contentType
        );
        if (!validation.isValid) {
          logError("Instagram Story validation failed", {
            error: validation.error,
          });
          return { success: false, error: validation.error || "Story validation failed" };
        }
        isVideoStory = validation.isVideo;
        logInfo(`Instagram Story validated`, {
          isVideo: isVideoStory,
          mediaUrl: post.mediaUrl ? "(set)" : "(empty)",
        });
      }

      // Step 1: Create media container
      const containerResult = await this.client.createMediaContainer(
        caption,
        post.mediaUrl ?? undefined,
        instagramMediaType,
        children.length > 0 ? children : undefined,
        isVideoStory
      );

      if (!containerResult.success || !containerResult.containerId) {
        logError("Instagram container creation failed", { error: containerResult.error });
        return { success: false, error: containerResult.error || "Container creation failed" };
      }

      logInfo(`Instagram container created`, { containerId: containerResult.containerId });

      // Step 2: Check container status (important for video/Reels/Carousels)
      // and then publish the container
      const publishResult = await this.client.publishContainer(containerResult.containerId);

      if (publishResult.success) {
        logInfo(`Instagram publish successful`, {
          postId: post.id,
          platformPostId: publishResult.postId,
          permalink: publishResult.permalink,
        });
      } else {
        logError(`Instagram publish failed`, { postId: post.id, error: publishResult.error });
      }

      return {
        success: publishResult.success,
        platformPostId: publishResult.postId ?? null,
        socialUrl: publishResult.permalink ?? null,
        error: publishResult.error ?? null,
      };
    } catch (err: any) {
      logError(`Instagram publish exception`, { postId: post.id, error: err.message });
      return { success: false, error: err.message || "Instagram publish failed" };
    }
  }
}

// ── Singleton ──

let instagramInstance: InstagramPublisher | null = null;

export function getInstagramPublisher(
  userId?: string,
  accessToken?: string
): InstagramPublisher {
  if (!instagramInstance && userId && accessToken) {
    instagramInstance = new InstagramPublisher(userId, accessToken);
  }
  if (!instagramInstance) {
    throw new Error(
      "Instagram publisher not configured. Provide userId and accessToken."
    );
  }
  return instagramInstance;
}

export function resetInstagramInstance(): void {
  instagramInstance = null;
}
