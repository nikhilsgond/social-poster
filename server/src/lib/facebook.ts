// server/src/lib/facebook.ts
// Facebook Graph API client.
// Centralizes all Facebook Graph API communication.
// Uses server-side Page Access Token only.
// Never logs the token.

const GRAPH_API_VERSION = "v19.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface FacebookConfig {
  pageId: string;
  pageAccessToken: string;
}

export interface FacebookTextPostResult {
  success: boolean;
  platformPostId?: string | null;
  socialUrl?: string | null;
  error?: string | null;
}

export interface FacebookImagePostResult {
  success: boolean;
  platformPostId?: string | null;
  socialUrl?: string | null;
  error?: string | null;
}

export interface FacebookScheduleResult {
  success: boolean;
  postId?: string | null;
  socialUrl?: string | null;
  error?: string | null;
  scheduledPublishTime?: number;
}

// ── Facebook Graph API Client ──

export class FacebookGraphClient {
  private config: FacebookConfig;

  constructor(config: FacebookConfig) {
    this.config = config;
  }

  // ── Internal request handler ──

  private async request(
    endpoint: string,
    params: Record<string, string>
  ): Promise<any> {
    // Append the access token to every request
    const allParams = { ...params, access_token: this.config.pageAccessToken };
    const queryString = new URLSearchParams(allParams).toString();
    const url = `${BASE_URL}/${endpoint}?${queryString}`;

    const response = await fetch(url, { method: "POST" });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new FacebookApiError(
        `Facebook API error ${response.status}: ${errorBody}`,
        response.status,
        errorBody
      );
    }

    const data = await response.json();
    return data;
  }

  // ── Publish text post ──

  async publishText(
    message: string,
    scheduledPublishTime?: number
  ): Promise<FacebookTextPostResult> {
    const params: Record<string, string> = { message };

    if (scheduledPublishTime) {
      params.published = "false";
      params.scheduled_publish_time = scheduledPublishTime.toString();
    } else {
      params.published = "true";
    }

    try {
      const data = await this.request(`${this.config.pageId}/feed`, params);
      return {
        success: true,
        platformPostId: data.id ?? null,
        socialUrl: data.id ? `https://www.facebook.com/${this.config.pageId}/posts/${data.id.split("_")[1] || data.id}` : null,
        error: null,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Facebook publish failed",
      };
    }
  }

  // ── Publish image post ──

  async publishImage(
    imageUrl: string,
    message?: string,
    scheduledPublishTime?: number
  ): Promise<FacebookImagePostResult> {
    const params: Record<string, string> = { url: imageUrl };

    if (message) {
      params.message = message;
    }

    if (scheduledPublishTime) {
      params.published = "false";
      params.scheduled_publish_time = scheduledPublishTime.toString();
    } else {
      params.published = "true";
    }

    try {
      const data = await this.request(`${this.config.pageId}/photos`, params);
      return {
        success: true,
        platformPostId: data.id ?? null,
        socialUrl: data.id ? `https://www.facebook.com/${this.config.pageId}/photos/${data.id.split("_")[1] || data.id}` : null,
        error: null,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Facebook image publish failed",
      };
    }
  }

  // ── Verify page access ──

  async verifyPageAccess(): Promise<boolean> {
    try {
      const data = await this.request(this.config.pageId, { fields: "name,access_token" });
      return !!data.name;
    } catch (err: any) {
      throw new Error(`Facebook verification failed: ${err.message}`);
    }
  }
}

// ── Facebook API Error ──

export class FacebookApiError extends Error {
  public statusCode: number;
  public body: string;

  constructor(message: string, statusCode: number, body: string) {
    super(message);
    this.name = "FacebookApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ── Utility ──

// Convert ISO datetime string to Unix timestamp (seconds)
export function toUnixTimestamp(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}
