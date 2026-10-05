// server/src/lib/threads.ts
// Threads API client.
// Uses the Threads API host (graph.threads.net).
// Implements media container creation and publishing.
// Never logs access tokens or secrets.

const BASE_URL = "https://graph.threads.net/v1.0";

export interface ThreadsConfig {
  userId: string;
  accessToken: string;
}

export interface ThreadsContainerResult {
  success: boolean;
  containerId?: string | null;
  error?: string | null;
}

export interface ThreadsPublishResult {
  success: boolean;
  postId?: string | null;
  permalink?: string | null;
  error?: string | null;
  containerNotReady?: boolean;
}

export type ThreadsMediaType = "TEXT" | "IMAGE" | "VIDEO";

// ── Threads API Error ──

export class ThreadsApiError extends Error {
  public statusCode: number;
  public body: string;

  constructor(message: string, statusCode: number, body: string) {
    super(message);
    this.name = "ThreadsApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

// Only this explicitly classified API failure is safe to retry on the same
// container. Do not infer readiness from message text or retry arbitrary 400s.
function isContainerNotReadyError(error: unknown): boolean {
  if (!(error instanceof ThreadsApiError) || error.statusCode !== 400) return false;

  try {
    const apiError = JSON.parse(error.body)?.error;
    return apiError?.code === 24 && apiError?.error_subcode === 4279009;
  } catch {
    return false;
  }
}

// ── Threads Graph API Client ──

export class ThreadsGraphClient {
  private config: ThreadsConfig;

  constructor(config: ThreadsConfig) {
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

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new ThreadsApiError(
        `Threads API error ${response.status}: ${errorBody}`,
        response.status,
        errorBody
      );
    }

    return response.json();
  }

  // ── Create media container ──
  // POST /{userId}/threads with media_type plus text and, for media posts,
  // the public image_url or video_url that Threads fetches directly.

  async createMediaContainer(
    caption: string,
    mediaUrl?: string,
    contentType: ThreadsMediaType = "TEXT"
  ): Promise<ThreadsContainerResult> {
    const params: Record<string, string> = {
      media_type: contentType,
    };

    if (caption) params.text = caption;

    if (contentType === "IMAGE") {
      if (!mediaUrl) return { success: false, error: "Threads Image requires a media URL" };
      params.image_url = mediaUrl;
    } else if (contentType === "VIDEO") {
      if (!mediaUrl) return { success: false, error: "Threads Video requires a media URL" };
      params.video_url = mediaUrl;
    }

    try {
      const data = await this.request(
        `${this.config.userId}/threads`,
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
        error: err.message || "Threads container creation failed",
      };
    }
  }

  // ── Publish container ──
  // POST /{userId}/threads_publish with creation_id=<containerId>.

  async publishContainer(
    creationId: string
  ): Promise<ThreadsPublishResult> {
    try {
      const data = await this.request(
        `${this.config.userId}/threads_publish`,
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
        error: err.message || "Threads publish failed",
        containerNotReady: isContainerNotReadyError(err),
      };
    }
  }

  // ── Verify access ──

  async verifyAccess(): Promise<boolean> {
    try {
      const data = await this.request(
        `${this.config.userId}`,
        { fields: "name,accounts" },
        "GET"
      );
      return !!data.name;
    } catch (err: any) {
      throw new Error(`Threads verification failed: ${err.message}`);
    }
  }
}
