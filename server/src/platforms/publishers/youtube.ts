// server/src/platforms/publishers/youtube.ts
// Real YouTube publisher.
// Uses the YouTube Graph API client to upload videos.
// The YouTube client (src/lib/youtube.ts) is completely isolated from
// the Instagram client (src/lib/instagram.ts), Threads client (src/lib/threads.ts),
// and Facebook client (src/lib/facebook.ts).
// Separate host, endpoints, parameters, tokens, and error types.
// Uses Google OAuth2 refresh_token flow for authentication.
// Respects the existing scheduled_at scheduling semantics.
// Never logs access tokens or refresh tokens.
//
// Upload flow: Cloudinary URL → download → multipart upload → videos.insert
// status.privacyStatus = "private"
// status.publishAt = scheduled_at (YouTube handles future publication)

import type { Post } from "../../types";
import type { PlatformPublisher, PublishResult } from "./interface";
import { YouTubeGraphClient } from "../../lib/youtube";
import { logInfo, logError } from "../../lib/logger";
import { getContentTypeCapability, validatePlatformPostCapability } from "../../platform-capabilities";

// ── YouTube media_type mapping ──
// Social Planner uses internal content types (e.g. "Image", "Video", "Carousel").
// YouTube API requires: "video".
// Only "Video" content type is supported for YouTube publishing.
// Other types are rejected locally before calling the API.

function mapToYouTubeContentType(contentType: string | undefined): string {
  const capability = getContentTypeCapability("yt", contentType);
  if (!capability) throw new Error(`Unsupported YouTube content type: ${contentType || "(empty)"}`);
  return capability.backendType;
}

export class YouTubePublisher implements PlatformPublisher {
  private client: YouTubeGraphClient;

  constructor(userId: string, accessToken: string, refreshToken: string) {
    this.client = new YouTubeGraphClient({ userId, accessToken, refreshToken });
  }

  async publish(post: Post): Promise<PublishResult> {
    logInfo(`YouTube publish received`, { postId: post.id, platform: post.platform });

    const validation = validatePlatformPostCapability(post);
    if (validation.errors.length > 0) {
      const error = validation.errors.join(" ");
      logError("YouTube publish validation failed", { postId: post.id, error });
      return { success: false, error };
    }

    const scheduledAt = post.scheduledAt;

    try {
      // Map content type
      const youTubeContentType = mapToYouTubeContentType(post.contentType);
      const title = post.title!;
      const description = post.description || post.content || "";

      // Step 1: Upload video to YouTube
      // The video is uploaded as PRIVATE with publishAt set to scheduled_at
      logInfo(`YouTube uploading video`, {
        postId: post.id,
        title,
        videoUrl: post.mediaUrl ? "(set)" : "(empty)",
        scheduledAt,
      });

      const uploadResult = await this.client.uploadVideo(
        post.mediaUrl!,
        title,
        description,
        scheduledAt
      );

      if (!uploadResult.success || !uploadResult.videoId) {
        logError("YouTube upload failed", { error: uploadResult.error });
        return { success: false, error: uploadResult.error || "Upload failed" };
      }

      logInfo(`YouTube upload successful`, { videoId: uploadResult.videoId });

      // Step 2: Verify video status
      const status = await this.client.getVideoStatus(uploadResult.videoId);

      logInfo(`YouTube video status verified`, {
        postId: post.id,
        privacyStatus: status.privacyStatus,
        publishAt: status.publishAt,
      });

      return {
        success: true,
        platformPostId: uploadResult.videoId,
        socialUrl: uploadResult.videoUrl ?? null,
        error: null,
      };
    } catch (err: any) {
      logError(`YouTube publish exception`, { postId: post.id, error: err.message });
      return { success: false, error: err.message || "YouTube publish failed" };
    }
  }
}

// ── Singleton ──

let youtubeInstance: YouTubePublisher | null = null;

export function getYouTubePublisher(
  userId?: string,
  accessToken?: string,
  refreshToken?: string
): YouTubePublisher {
  if (!youtubeInstance && userId && accessToken && refreshToken) {
    youtubeInstance = new YouTubePublisher(userId, accessToken, refreshToken);
  }
  if (!youtubeInstance) {
    throw new Error(
      "YouTube publisher not configured. Provide userId, accessToken, and refreshToken."
    );
  }
  return youtubeInstance;
}

export function resetYouTubeInstance(): void {
  youtubeInstance = null;
}
