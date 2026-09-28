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
}

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
  // POST /{userId}/threads with media_type=TEXT and text=<content>.

  async createMediaContainer(
    caption: string,
    mediaUrl?: string,
    contentType?: string
  ): Promise<ThreadsContainerResult> {
    const params: Record<string, string> = {
      media_type: contentType || "TEXT",
      text: caption,
    };

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
