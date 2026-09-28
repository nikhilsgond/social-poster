// server/src/lib/instagram.ts
// Instagram Graph API client.
// Uses the Meta Graph API host (graph.facebook.com) but with Instagram-specific
// endpoints, parameters, and media types. Completely separate from Threads
// (graph.threads.net) and Facebook Page API (graph.facebook.com/feed).
// Never logs access tokens or secrets.

const GRAPH_API_VERSION = "v26.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

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

  private async request(
    endpoint: string,
    params: Record<string, string>,
    method: string = "POST"
  ): Promise<any> {
    const allParams = { ...params, access_token: this.config.accessToken };
    const queryString = new URLSearchParams(allParams).toString();
    const url = `${BASE_URL}/${endpoint}?${queryString}`;

    const response = await fetch(url, { method });

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
  // Instagram API: POST /{userId}/media
  // For images: image_url, media_type=IMAGE
  // For videos: video_url, media_type=VIDEO
  // media_type is the correct parameter name (NOT content_type).
  // image_url / video_url are the correct URL param names (NOT url).

  async createMediaContainer(
    caption: string,
    mediaUrl?: string,
    contentType?: string
  ): Promise<InstagramContainerResult> {
    const mediaType = (contentType || "IMAGE").toUpperCase();
    const params: Record<string, string> = {
      caption,
      media_type: mediaType,
    };

    if (mediaUrl) {
      if (mediaType === "VIDEO") {
        params.video_url = mediaUrl;
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

  // ── Publish container ──

  async publishContainer(
    creationId: string
  ): Promise<InstagramPublishResult> {
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
