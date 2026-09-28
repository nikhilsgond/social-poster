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

export class InstagramGraphClient {
  private config: InstagramConfig;

  constructor(config: InstagramConfig) {
    this.config = config;
  }

  // ── Internal request handler ──
  // For graph.instagram.com:
  // POST requests use JSON body + Authorization: Bearer <token> header
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
  // For carousels: media_type=CAROUSEL, children (comma-separated child IDs)
  // POST body is JSON with Authorization: Bearer <token> header.
  // Media URLs must be publicly accessible — Meta cURLs them.

  async createMediaContainer(
    caption: string,
    mediaUrl?: string,
    contentType?: string,
    children?: string[]
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
      // IMAGE, VIDEO, and REELS all use video_url for video/reel content
      if (mediaType === "VIDEO" || mediaType === "REELS") {
        params.video_url = mediaUrl;
        // Reels-specific optional parameters
        if (mediaType === "REELS") {
          params.share_to_feed = "false";
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
  // Before publishing, especially for video/Reels/Carousels,
  // the container must be in a ready state.
  // Status codes: PROCESSING, FINISHED, READY, ERROR
  // Only publish when status is FINISHED or READY.

  async checkContainerStatus(
    containerId: string
  ): Promise<{ ready: boolean; status: string; error?: string }> {
    try {
      const data = await this.request(
        `${containerId}`,
        { fields: "status_code" },
        "GET"
      );
      const status = data.status_code ?? "UNKNOWN";
      const ready = status === "FINISHED" || status === "READY";
      return {
        ready,
        status,
        error: status === "ERROR" ? "Container processing failed" : undefined,
      };
    } catch (err: any) {
      return {
        ready: false,
        status: "UNKNOWN",
        error: err.message || "Failed to check container status",
      };
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
