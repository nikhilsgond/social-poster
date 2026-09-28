// server/src/lib/instagram.ts
// Instagram Graph API client.
// Uses the Instagram-specific API host graph.instagram.com (not graph.facebook.com).
// This is the official host for Instagram Content Publishing API.
// Completely separate from Threads (graph.threads.net) and Facebook Page API
// (graph.facebook.com/feed).
// Never logs access tokens or secrets.
//
// Official API reference: https://developers.facebook.com/docs/instagram-platform/
// API version v26.0 is the current latest.
// Authentication uses Authorization: Bearer <token> header.
// POST body is JSON. Media URLs must be publicly accessible.

import { logInfo, logWarn } from "./logger";

const GRAPH_API_VERSION = "v26.0";
const BASE_URL = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

export interface InstagramConfig {
  userId: string;
  accessToken: string;
}

export interface InstagramContainerResult {
  success: boolean;
  containerId?: string | null;
  error?: string | null;
}

export interface InstagramPublishResult {
  success: boolean;
  postId?: string | null;
  permalink?: string | null;
  error?: string | null;
}

// ── Instagram API Error ──

export class InstagramApiError extends Error {
  public statusCode: number;
  public body: string;

  constructor(message: string, statusCode: number, body: string) {
    super(message);
    this.name = "InstagramApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ── Instagram Graph API Client ──

// ── Story video size limit (official Meta docs: 8MB for video Stories) ──
const STORY_VIDEO_MAX_BYTES = 8 * 1024 * 1024; // 8MB

// Determine if a Story content type indicates a video Story.
// Uses the original Post contentType from the scheduled post.
// "StoryVideo" or "StoryVideo" → true (video Story)
// "StoryImage", "Story", "Stories" → false (image Story)
// Does NOT use URL extension guessing.
// Returns false for any content type that does not clearly indicate a video Story,
// so image Stories are never silently converted.
function isStoryVideoContentType(contentType: string | undefined): boolean {
  const upper = (contentType || "").toUpperCase();
  // Only returns true if the content type explicitly indicates video
  return upper.includes("VIDEO");
}

// Validate Story media requirements before creating a container.
// For video Stories, attempts to enforce the official 8MB file size limit.
// If Content-Length cannot be determined, the validation is skipped (fail open)
// rather than incorrectly rejecting a valid Story. Meta will reject at the
// API level if the file is too large.
// Returns { isValid: true } if validation passes or cannot be performed.
// Returns { isValid: false } only if validation definitively fails.
export async function validateStoryMedia(
  mediaUrl: string | undefined,
  contentType: string | undefined
): Promise<{ isValid: boolean; isVideo: boolean; error?: string }> {
  if (!mediaUrl) {
    return { isValid: false, isVideo: false, error: "Story mediaUrl is required" };
  }

  // Reject ambiguous content types that don't clearly indicate image or video
  const upper = (contentType || "").toUpperCase();
  if (upper === "STORY" || upper === "STORIES") {
    return {
      isValid: false,
      isVideo: false,
      error: `Story content type "${contentType}" is ambiguous. Use "StoryImage" or "StoryVideo" to specify the media type explicitly.`,
    };
  }

  const isVideo = isStoryVideoContentType(contentType);

  // For video Stories, attempt to enforce the official 8MB size limit
  if (isVideo) {
    try {
      const headResponse = await fetch(mediaUrl, { method: "HEAD" });
      const contentLength = headResponse.headers.get("content-length");
      const sizeBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (sizeBytes > STORY_VIDEO_MAX_BYTES) {
        return {
          isValid: false,
          isVideo: true,
          error: `Story video exceeds 8MB limit (${(sizeBytes / 1024 / 1024).toFixed(1)}MB). Reduce file size before scheduling.`,
        };
      }

      if (!contentLength) {
        logWarn("Story video size validation skipped — Content-Length not available, proceeding with validation at Meta's end");
      }
    } catch {
      // HEAD request failed (network error, CDN issue, etc.).
      // Do not reject the Story — proceed and let Meta handle validation.
      logWarn("Story video size validation skipped — could not fetch Content-Length, proceeding");
    }
  }

  return { isValid: true, isVideo };
}

export class InstagramGraphClient {
  private config: InstagramConfig;

  constructor(config: InstagramConfig) {
    this.config = config;
  }

  // ── Internal request handler ──
  // For graph.instagram.com:
  // POST requests use JSON body + Authorization: Bearer *** header
  // GET requests use query params for fields

  private async request(
    endpoint: string,
    params: Record<string, string>,
    method: string = "POST"
  ): Promise<any> {
    const url = `${BASE_URL}/${endpoint}`;

    if (method === "GET") {
      // GET: pass fields as query params, auth as Bearer header
      const queryString = new URLSearchParams(params).toString();
      const fullUrl = `${url}?${queryString}`;
      const response = await fetch(fullUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new InstagramApiError(
          `Instagram API error ${response.status}: ${errorBody}`,
          response.status,
          errorBody
        );
      }
      return response.json();
    }

    // POST: send JSON body with Authorization: Bearer header
    const body = JSON.stringify(params);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new InstagramApiError(
        `Instagram API error ${response.status}: ${errorBody}`,
        response.status,
        errorBody
      );
    }

    return response.json();
  }

  // ── Create media container ──
    // Instagram API: POST https://graph.instagram.com/v26.0/{userId}/media
    // Official reference: https://developers.facebook.com/docs/instagram-platform/
    //
    // For images: image_url, media_type=IMAGE
    // For videos: video_url, media_type=VIDEO
    // For reels:  video_url, media_type=REELS, share_to_feed
    // For stories: image_url or video_url, media_type=STORIES (determined by isVideoStory)
    // For carousels: media_type=CAROUSEL, children (comma-separated child IDs)
    // POST body is JSON with Authorization: Bearer *** header.
    // Media URLs must be publicly accessible — Meta cURLs them.

    async createMediaContainer(
      caption: string,
      mediaUrl?: string,
      contentType?: string,
      children?: string[],
      isVideoStory?: boolean
    ): Promise<InstagramContainerResult> {
      const mediaType = (contentType || "IMAGE").toUpperCase();
      const params: Record<string, string> = {
        caption,
        media_type: mediaType,
      };

      // Carousel: use children parameter with comma-separated child container IDs
      if (mediaType === "CAROUSEL_ALBUM" && children && children.length > 0) {
        params.children = children.join(",");
      } else if (mediaUrl) {
        // IMAGE and non-video Stories use image_url; VIDEO, REELS, and video Stories use video_url
        if (mediaType === "VIDEO" || mediaType === "REELS") {
          params.video_url = mediaUrl;
          // Reels-specific optional parameters
          if (mediaType === "REELS") {
            params.share_to_feed = "false";
          }
        } else if (mediaType === "STORIES") {
          if (isVideoStory) {
            params.video_url = mediaUrl;
          } else {
            params.image_url = mediaUrl;
          }
        } else {
          params.image_url = mediaUrl;
        }
      }

    try {
      const data = await this.request(
        `${this.config.userId}/media`,
        params
      );
      return {
        success: true,
        containerId: data.id ?? null,
        error: null,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Instagram container creation failed",
      };
    }
  }

  // ── Check container status ──
  // Instagram API: GET /{containerId}?fields=status_code
  // Before publishing, especially for video/Reels/Carousels and Stories,
  // the container must be in a ready state. Meta may need time to process.
  // Status codes: IN_PROGRESS, PROCESSING, FINISHED, READY, ERROR, EXPIRED
  // Polls every 30 seconds, maximum 180 seconds total.

  async checkContainerStatus(
    containerId: string
  ): Promise<{ ready: boolean; status: string; error?: string }> {
    const maxWaitMs = 180_000;
    const pollIntervalMs = 30_000;
    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      attempt++;
      try {
        const data = await this.request(
          `${containerId}`,
          { fields: "status_code" },
          "GET"
        );
        const status = data.status_code ?? "UNKNOWN";

        logInfo(`Instagram container status`, {
          containerId,
          status,
          attempt,
        });

        if (status === "FINISHED" || status === "READY") {
          return { ready: true, status };
        }

        // EXPIRED or ERROR → fail immediately
        if (status === "ERROR" || status === "EXPIRED") {
          return {
            ready: false,
            status,
            error: `Container ${status.toLowerCase()}: ${status === "EXPIRED" ? "Container expired before processing completed." : "Container processing failed."}`,
          };
        }

        // IN_PROGRESS, PROCESSING, or other status — still processing
        const elapsed = Date.now() - startTime;
        if (elapsed >= maxWaitMs) {
          return {
            ready: false,
            status,
            error: `Container not ready after ${maxWaitMs / 1000}s timeout`,
          };
        }

        // Wait 5 seconds before checking again
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      } catch (err: any) {
        return {
          ready: false,
          status: "UNKNOWN",
          error: err.message || "Failed to check container status",
        };
      }
    }
  }

  // ── Publish container ──
  // Instagram API: POST /{userId}/media_publish
  // creation_id=<containerId>
  // Before publishing, check container status to ensure it's ready.
  // Especially important for video/Reels/Carousels which need processing time.
  // Status codes: PROCESSING, FINISHED, READY, ERROR

  async publishContainer(
    creationId: string
  ): Promise<InstagramPublishResult> {
    // Check container status before publishing
    const status = await this.checkContainerStatus(creationId);
    if (!status.ready) {
      return {
        success: false,
        error: `Container not ready for publishing. Status: ${status.status}${status.error ? ` — ${status.error}` : ""}`,
      };
    }

    try {
      const data = await this.request(
        `${this.config.userId}/media_publish`,
        { creation_id: creationId }
      );
      return {
        success: true,
        postId: data.id ?? null,
        permalink: data.permalink ?? null,
        error: null,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Instagram publish failed",
      };
    }
  }

  // ── Verify access ──

  async verifyAccess(): Promise<boolean> {
    try {
      const data = await this.request(
        this.config.userId,
        { fields: "name,accounts" },
        "GET"
      );
      return !!data.name;
    } catch (err: any) {
      throw new Error(`Instagram verification failed: ${err.message}`);
    }
  }
}
