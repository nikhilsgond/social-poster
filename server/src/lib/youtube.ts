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
import { randomUUID } from "node:crypto";

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

interface YouTubeErrorResponse {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
  };
}

function sanitizeGoogleDiagnostic(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sanitized = value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return sanitized ? sanitized.slice(0, 500) : null;
}

export function formatYouTubeApiFailure(
  operation: string,
  statusCode: number,
  responseBody: string
): string {
  let parsed: YouTubeErrorResponse | null = null;
  try {
    parsed = JSON.parse(responseBody) as YouTubeErrorResponse;
  } catch {
    // Do not surface arbitrary non-JSON response bodies.
  }

  const googleError = parsed?.error;
  const message = sanitizeGoogleDiagnostic(googleError?.message) || "Google API request failed";
  const reason = sanitizeGoogleDiagnostic(googleError?.errors?.[0]?.reason)
    || sanitizeGoogleDiagnostic(googleError?.status);
  const diagnostic = reason ? `${message} [${reason}]` : message;
  return `${operation} (${statusCode}): ${diagnostic}`;
}

export function resolveYouTubeMediaType(contentType: string | null): string {
  const normalized = contentType?.split(";", 1)[0].trim().toLowerCase();
  return normalized?.startsWith("video/") ? normalized : "application/octet-stream";
}

export function buildYouTubeVideoMetadata(
  title: string,
  description: string,
  scheduledAt?: string
) {
  return {
    snippet: {
      title,
      description,
      tags: ["ctrlplusexcel", "api-test"],
    },
    status: {
      privacyStatus: "private" as const,
      publishAt: scheduledAt || undefined,
    },
  };
}

export function buildYouTubeMultipartBody(
  metadata: ReturnType<typeof buildYouTubeVideoMetadata>,
  videoBytes: Buffer,
  mediaType: string,
  boundary: string
): Buffer {
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\n`),
    Buffer.from("Content-Type: application/json; charset=UTF-8\r\n\r\n"),
    Buffer.from(JSON.stringify(metadata), "utf-8"),
    Buffer.from(`\r\n--${boundary}\r\n`),
    Buffer.from(`Content-Type: ${mediaType}\r\n\r\n`),
    videoBytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
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
        formatYouTubeApiFailure("YouTube API request failed", response.status, errorBody),
        response.status,
        errorBody
      );
    }
    return response.json();
  }

  // ── Upload a video ──
  // Uses the YouTube Data API v3 upload endpoint with a single multipart upload.
  // YouTube also supports resumable uploads, which are recommended for reliability
  // with larger files but are not required by the videos.insert endpoint.
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

        const metadata = buildYouTubeVideoMetadata(title, description, scheduledAt);
        const mediaType = resolveYouTubeMediaType(videoResponse.headers.get("content-type"));
        const boundary = `youtube_${randomUUID().replaceAll("-", "")}`;
        const body = buildYouTubeMultipartBody(metadata, videoBuffer, mediaType, boundary);

        const accessToken = await this.getAccessToken();
        const uploadUrl = `https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status&uploadType=multipart`;

        const uploadResponse = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": `multipart/related; boundary="${boundary}"`,
            "Content-Length": String(body.byteLength),
          },
          body: new Uint8Array(body),
        });

        if (!uploadResponse.ok) {
          const errorBody = await uploadResponse.text();
          throw new YouTubeApiError(
            formatYouTubeApiFailure("YouTube upload failed", uploadResponse.status, errorBody),
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
