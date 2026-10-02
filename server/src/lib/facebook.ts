// server/src/lib/facebook.ts
// Facebook Graph API client.
// Centralizes all Facebook Graph API communication.
// Uses server-side Page Access Token only.
// Never logs the token.

const GRAPH_API_VERSION = "v26.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

export interface FacebookConfig {
  pageId: string;
  pageAccessToken: string;
  reelPollingAttempts?: number;
  reelPollingIntervalMs?: number;
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
    params: Record<string, string>,
    method: string = "POST"
  ): Promise<any> {
    // Append the access token to every request
    const allParams = { ...params, access_token: this.config.pageAccessToken };
    const queryString = new URLSearchParams(allParams).toString();
    const url = `${BASE_URL}/${endpoint}?${queryString}`;

    const response = await fetch(url, { method, signal: AbortSignal.timeout(30000) });

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
      await this.verifyMedia(imageUrl, "image");
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

  private async verifyMedia(url: string, type: "image" | "video"): Promise<void> {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Media must use HTTP/HTTPS.");
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.headers.get("content-type")?.toLowerCase().startsWith(`${type}/`)) {
      throw new Error(`Facebook media must be a publicly accessible ${type}.`);
    }
  }

  private safeError(error: unknown): string {
    return (error instanceof Error ? error.message : "Facebook publish failed")
      .split(this.config.pageAccessToken).join("[redacted]");
  }

  async publishMultipleImages(
    imageUrls: string[], message?: string, scheduledPublishTime?: number,
  ): Promise<FacebookImagePostResult> {
    try {
      if (imageUrls.length < 2) throw new Error("Multiple Images requires at least two images.");
      // Validate the entire batch before creating any unpublished photos.
      for (const url of imageUrls) await this.verifyMedia(url, "image");
      const attachedMedia: { media_fbid: string }[] = [];
      for (const url of imageUrls) {
        const photo = await this.request(`${this.config.pageId}/photos`, { url, published: "false" });
        if (!photo.id) throw new Error("Facebook did not return an unpublished photo ID.");
        attachedMedia.push({ media_fbid: photo.id });
      }
      const params: Record<string, string> = {
        attached_media: JSON.stringify(attachedMedia),
        published: scheduledPublishTime ? "false" : "true",
      };
      if (message) params.message = message;
      if (scheduledPublishTime) params.scheduled_publish_time = String(scheduledPublishTime);
      const data = await this.request(`${this.config.pageId}/feed`, params);
      if (!data.id) throw new Error("Facebook did not return the multi-photo post ID.");
      return { success: true, platformPostId: data.id, socialUrl: `https://www.facebook.com/${data.id}` };
    } catch (error) {
      return { success: false, error: this.safeError(error) };
    }
  }

  async publishReel(
    videoUrl: string, description?: string, scheduledPublishTime?: number,
  ): Promise<FacebookImagePostResult> {
    let videoId: string | undefined;
    let finalizationAttempted = false;
    try {
      await this.verifyMedia(videoUrl, "video");
      const initialized = await this.request(`${this.config.pageId}/video_reels`, { upload_phase: "start" });
      videoId = initialized.video_id;
      if (!videoId || !initialized.upload_url) throw new Error("Facebook did not initialize the Reel upload.");
      const uploadUrl = new URL(initialized.upload_url);
      if (uploadUrl.protocol !== "https:" || uploadUrl.hostname !== "rupload.facebook.com") {
        throw new Error("Facebook returned an unexpected Reel upload host.");
      }
      const transfer = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `OAuth ${this.config.pageAccessToken}`, file_url: videoUrl },
        signal: AbortSignal.timeout(60000),
      });
      const transferData = await transfer.json() as { success?: boolean };
      if (!transfer.ok || !transferData.success) throw new Error("Facebook Reel hosted-video transfer failed.");
      const params: Record<string, string> = {
        upload_phase: "finish", video_id: videoId!,
        // Page.create_video_reel supports SCHEDULED + scheduled_publish_time
        // in Meta's current SDK, alongside the existing native feed schedule.
        video_state: scheduledPublishTime ? "SCHEDULED" : "PUBLISHED",
      };
      if (description) params.description = description;
      if (scheduledPublishTime) params.scheduled_publish_time = String(scheduledPublishTime);
      finalizationAttempted = true;
      const finished = await this.request(`${this.config.pageId}/video_reels`, params);
      if (!finished.success) throw new Error("Facebook Reel finalization failed.");
      const attempts = this.config.reelPollingAttempts ?? 60;
      for (let attempt = 0; attempt < attempts; attempt++) {
        const data = await this.request(videoId!, { fields: "status" }, "GET");
        const status = data.status;
        const phases = [status?.uploading_phase, status?.processing_phase, status?.publishing_phase];
        if (["error", "failed"].includes(status?.video_status) || phases.some((phase) => ["error", "failed"].includes(phase?.status))) {
          throw new Error("Facebook Reel processing or publishing failed. Check the retained video ID before retrying.");
        }
        const processed = status?.processing_phase?.status === "complete" || status?.video_status === "ready";
        if (scheduledPublishTime ? processed : status?.publishing_phase?.status === "complete") {
          return { success: true, platformPostId: videoId, socialUrl: `https://www.facebook.com/reel/${videoId}` };
        }
        if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, this.config.reelPollingIntervalMs ?? 2000));
      }
      throw new Error("Facebook Reel status is still pending. Check the retained video ID before retrying.");
    } catch (error) {
      // An ambiguous finish/status response must not cause automatic duplicate publishing.
      return { success: false, platformPostId: finalizationAttempted ? videoId : undefined, error: this.safeError(error) };
    }
  }

  async verifyPageAccess(): Promise<boolean> {
    try {
      const data = await this.request(this.config.pageId, { fields: "name,access_token" }, "GET");
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
