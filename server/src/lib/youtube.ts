// server/src/lib/youtube.ts
// YouTube Graph API client.
// Uses google-auth-library for OAuth2 token management.
// Separate from Instagram (graph.instagram.com) and Threads (graph.threads.net).
// Never logs access tokens or refresh tokens.
//
// Official API reference: https://developers.google.com/youtube/v3
// Upload endpoint: POST /upload/youtube/v3/videos
//
// Uses Google OAuth2 refresh_token flow to get access tokens.
// Access tokens are refreshed automatically when expired.

import { OAuth2Client } from "google-auth-library";

export interface YouTubeConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface YouTubeUploadResult {
  success: boolean;
  videoId?: string | null;
  videoUrl?: string | null;
  error?: string | null;
}

export interface YouTubeVideoStatus {
  id: string;
  privacyStatus: string;
  publishAt: string | null;
  title: string;
}

// ── YouTube API Error ──

export class YouTubeApiError extends Error {
  public statusCode: number;
  public body: string;

  constructor(message: string, statusCode: number, body: string) {
    super(message);
    this.name = "YouTubeApiError";
    this.statusCode = statusCode;
    this.body = body;
  }
}

// ── YouTube Graph API Client ──

export class YouTubeGraphClient {
  private oauth2Client: OAuth2Client;

  constructor(config: YouTubeConfig) {
    this.oauth2Client = new OAuth2Client({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: "http://localhost:8080/",
    });
    this.oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });
  }

  // ── Get a fresh access token from the refresh token ──

  async getAccessToken(): Promise<string> {
    const result = await this.oauth2Client.refreshAccessToken();
    const accessToken = result.credentials.access_token;
    if (!accessToken) {
      throw new YouTubeApiError("Failed to refresh access token", 401, "");
    }
    return accessToken;
  }

  // ── Internal request handler ──

  private async request(
    endpoint: string,
    method: string = "GET",
    body?: Record<string, unknown>
  ): Promise<any> {
    const accessToken = await this.getAccessToken();
    const url = `https://www.googleapis.com${endpoint}`;

    const options: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`
                ,"Content-Type": "application/json",
      },
    };

    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    if (!response.ok) {
      const errorBody = await response.text();
      throw new YouTubeApiError(
        `YouTube API error ${response.status}: ${errorBody}`,
        response.status,
        errorBody
      );
    }
    return response.json();
  }

  // ── Upload a video ──
  // Uses the YouTube Data API v3 upload endpoint with multipart upload.
  // For small files (< 5MB), uses simple upload.
  // For larger files, would use resumable upload.
  //
  // status.privacyStatus = "private" — video is not publicly visible
  // status.publishAt = scheduled_at — YouTube publishes at this time
  // snippet.title, snippet.description, snippet.tags

  async uploadVideo(
      videoUrl: string,
      title: string,
      description: string,
      scheduledAt?: string
    ): Promise<YouTubeUploadResult> {
      try {
        // Fetch video from Cloudinary URL
        const videoResponse = await fetch(videoUrl);
        if (!videoResponse.ok) {
          return {
            success: false,
            error: `Failed to download video from Cloudinary: ${videoResponse.status}`,
          };
        }
        const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        const metadata = {
          snippet: {
            title,
            description,
            tags: ["ctrlplusexcel", "api-test"],
          },
          status: {
            privacyStatus: "private" as const,
            publishAt: scheduledAt || undefined,
            selfMadeMadeForKids: false,
          },
        };

        // Multipart upload for small files (< 5MB)
        const boundary = "----YouTubeMultipartBoundaryXYZ";
        const metadataBytes = Buffer.from(JSON.stringify(metadata), "utf-8");
        const videoBytes = Buffer.from(videoBuffer);

        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\n`),
          Buffer.from("Content-Type: application/json; charset=UTF-8\r\n\r\n"),
          metadataBytes,
          Buffer.from(`\r\n--${boundary}\r\n`),
          Buffer.from("video/*\r\n\r\n"),
          videoBytes,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const accessToken = await this.getAccessToken();
        const uploadUrl = `https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart`;

        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary="${boundary}"`,
          },
          body,
        });

        if (!uploadResponse.ok) {
          const errorBody = await uploadResponse.text();
          throw new YouTubeApiError(
            `YouTube upload failed: ${uploadResponse.status}`,
            uploadResponse.status,
            errorBody
          );
        }

        const result = await uploadResponse.json();

        return {
          success: true,
          videoId: result.id ?? null,
          videoUrl: result.id ? `https://www.youtube.com/watch?v=${result.id}` : null,
          error: null,
        };
      } catch (err: any) {
        if (err instanceof YouTubeApiError) throw err;
        return {
          success: false,
          error: err.message || "YouTube video upload failed",
        };
      }
    }

  // ── Get video status ──

  async getVideoStatus(videoId: string): Promise<YouTubeVideoStatus> {
    const data = await this.request(
      `/youtube/v3/videos?part=snippet,status&id=${videoId}`
    );
    const item = data.items?.[0];
    if (!item) {
      throw new YouTubeApiError("Video not found", 404, "");
    }
    return {
      id: item.id,
      privacyStatus: item.status.privacyStatus,
      publishAt: item.status.publishAt ?? null,
      title: item.snippet.title,
    };
  }

  // ── Verify authenticated account ──

  async getAuthenticatedChannel(): Promise<{ name: string; id: string }> {
    const data = await this.request(
      "/youtube/v3/channels?part=snippet,contentDetails&mine=true"
    );
    const channel = data.items?.[0];
    if (!channel) {
      throw new YouTubeApiError("No authenticated channel found", 401, "");
    }
    return {
      name: channel.snippet.title,
      id: channel.id,
    };
  }
}
