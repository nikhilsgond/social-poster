import type { Post } from "../types/post";

const OWNER_TOKEN_KEY = "social-planner:owner-api-key";
const backendUrl = (import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:3001").replace(/\/$/, "");

export class NativeSubmissionError extends Error {
  constructor(message: string, public readonly canMarkFailed = false) {
    super(message);
    this.name = "NativeSubmissionError";
  }
}

function requestOwnerToken(): string {
  const existing = sessionStorage.getItem(OWNER_TOKEN_KEY);
  if (existing) return existing;
  const supplied = window.prompt("Enter your Social Planner owner API key for this protected operation:")?.trim() || "";
  if (!supplied) throw new NativeSubmissionError("This operation requires the owner API key.", true);
  sessionStorage.setItem(OWNER_TOKEN_KEY, supplied);
  return supplied;
}

export type MetricsSyncPlatform = "ig" | "th" | "fb" | "yt";

export interface PlatformMetricsSyncResult {
  discovered: number;
  added: number;
  existing: number;
  updated: number;
  failed: number;
  snapshotFailures: number;
  unavailable?: boolean;
  errors: string[];
}

export interface MetricsSyncReport {
  success: boolean;
  startedAt: string;
  completedAt: string;
  summary: { discovered: number; added: number; existing: number; updated: number; failed: number; snapshotFailures: number };
  platforms: Partial<Record<MetricsSyncPlatform, PlatformMetricsSyncResult>>;
  errors: string[];
}

export interface MetricsSyncRequest {
  startDate: string;
  endDateExclusive: string;
  startTime: string;
  endTimeExclusive: string;
  timeZone: string;
  platform: MetricsSyncPlatform;
}

export async function syncMetrics(request: MetricsSyncRequest): Promise<MetricsSyncReport> {
  const params = new URLSearchParams({
    startDate: request.startDate,
    endDateExclusive: request.endDateExclusive,
    startTime: request.startTime,
    endTimeExclusive: request.endTimeExclusive,
    timeZone: request.timeZone,
    platform: request.platform,
  });
  const response = await fetch(`${backendUrl}/metrics/sync?${params.toString()}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requestOwnerToken()}` },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) sessionStorage.removeItem(OWNER_TOKEN_KEY);
  if (!response.ok) {
    const publicMessage = response.status === 400 && typeof body.error === "string"
      ? body.error
      : response.status === 401
        ? "The owner API key was rejected."
        : "The metrics service could not complete this request.";
    throw new Error(publicMessage);
  }
  return body as MetricsSyncReport;
}

export async function submitNativePost(post: Post): Promise<Post> {
  if (post.status !== "scheduled" || (post.platform !== "fb" && post.platform !== "yt")) return post;
  if (!post.scheduledAt || Number.isNaN(new Date(post.scheduledAt).getTime())) {
    throw new NativeSubmissionError("Scheduled Facebook/YouTube posts require a valid scheduled timestamp.", true);
  }

  const route = new Date(post.scheduledAt).getTime() > Date.now() ? "schedule" : "publish";
  const response = await fetch(`${backendUrl}/${route}/${encodeURIComponent(post.id)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${requestOwnerToken()}` },
  });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401) sessionStorage.removeItem(OWNER_TOKEN_KEY);
  if (!response.ok || !body.success) {
    throw new NativeSubmissionError(
      body.error || `Backend ${route} request failed (${response.status}).`,
      response.status === 401
    );
  }
  return body.post || post;
}
