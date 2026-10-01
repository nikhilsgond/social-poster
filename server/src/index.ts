// server/src/index.ts
// Social Poster Backend Server.
// HTTP server with health check, test mode, and real publishing.
// Independent of the React frontend.

import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseServer } from "./lib/supabase";
import { logInfo, logError, logWarn } from "./lib/logger";
import { runTestMode } from "./test-mode";
import { claimDuePostForPublishing, claimPostForNativeScheduling, getPostById, updatePublishingResult, updatePublishingError, updateSchedulingResult, updateMetrics } from "./posts";
import { routePublisher } from "./platforms/router";
import { SyncMetricsService, InstagramMetricsProvider, ThreadsMetricsProvider, YouTubeMetricsProvider, FacebookMetricsProvider } from "./metrics";
import { applyCors, hasValidOwnerToken, rejectUnauthorized } from "./lib/http-security";
import { runDuePostWorker } from "./due-post-worker";

// Load environment variables from .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Validate required environment variables
function validateConfig(): boolean {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "META_PAGE_ID", "META_PAGE_ACCESS_TOKEN", "OWNER_API_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logError(`Missing required environment variables: ${missing.join(", ")}`);
    return false;
  }

  if ((process.env.OWNER_API_KEY || "").length < 32) {
    logError("OWNER_API_KEY must contain at least 32 characters");
    return false;
  }

  logInfo("Server configuration validated");
  return true;
}

// ── HTTP Server ──

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || "0.0.0.0";
const METRICS_SYNC_PLATFORMS = new Set(["ig", "th", "fb", "yt"]);
const MAX_METRICS_SYNC_DAYS = 366;

function parseCalendarDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  const originAllowed = applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(originAllowed ? 204 : 403);
    res.end();
    return;
  }

  // Health check
  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    logInfo("Health check requested");
    return;
  }

  // All remaining routes expose private planner data or invoke operations with
  // Supabase service-role/platform credentials.
  if (!originAllowed || !hasValidOwnerToken(req)) {
    rejectUnauthorized(res);
    return;
  }

  // Test mode
  if (url.pathname === "/test" && req.method === "POST") {
    try {
      const result = await runTestMode();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      logInfo("Test mode executed", { duePostsFound: result.duePostsFound });
    } catch (err: any) {
      logError("Test mode failed", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Publish due Instagram/Threads posts. Intended for an authenticated
  // external scheduler such as cron-job.org.
  if (url.pathname === "/posts/due" && req.method === "POST") {
    try {
      const result = await runDuePostWorker();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: result.ok,
        due: result.due,
        published: result.published,
        failed: result.failed,
      }));
    } catch (err: any) {
      logError("Due-post worker failed", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Due-post worker could not be completed" }));
    }
    return;
  }

  // Get post by ID
  if (url.pathname.match(/^\/posts\/[^\/]+$/) && req.method === "GET") {
    const id = url.pathname.split("/").pop();
    try {
      const post = await getPostById(id!);
      if (post) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(post));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post not found" }));
      }
    } catch (err: any) {
      logError("Failed to get post", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Route publisher for a specific post — REAL publishing
  if (url.pathname.match(/^\/publish\/[^\/]+$/) && req.method === "POST") {
    const id = url.pathname.split("/").pop()!;
    try {
      const post = await claimDuePostForPublishing(id);
      if (!post) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post is not due, has no valid schedule, or was already claimed" }));
        return;
      }

      const result = await routePublisher(post);
      let updatedPost = null;

      if (result.success) {
        updatedPost = await updatePublishingResult(
          id,
          result.platformPostId ?? "",
          result.socialUrl ?? ""
        );
      } else {
        updatedPost = await updatePublishingError(id, result.error ?? "Publishing failed");
      }

      res.writeHead(result.success ? 200 : 502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...result, post: updatedPost }));
      logInfo(`Publish route executed for ${id}`, { success: result.success });
    } catch (err: any) {
      logError("Publish route failed", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Route publisher for native scheduling
  if (url.pathname.match(/^\/schedule\/[^\/]+$/) && req.method === "POST") {
    const id = url.pathname.split("/").pop()!;
    try {
      const post = await claimPostForNativeScheduling(id);
      if (!post) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post is not a claimable future Facebook/YouTube post or was already scheduled" }));
        return;
      }

      const result = await routePublisher(post);
      let updatedPost = null;

      if (result.success) {
        // Update Supabase with scheduling result — keep status as "scheduled"
        // since YouTube/Facebook hold the native future schedule
        updatedPost = await updateSchedulingResult(
          id,
          result.platformPostId ?? "",
          result.socialUrl ?? ""
        );
      } else {
        updatedPost = await updatePublishingError(id, result.error ?? "Scheduling failed");
      }

      res.writeHead(result.success ? 200 : 502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ...result, post: updatedPost }));
      logInfo(`Schedule route executed for ${id}`, { success: result.success });
    } catch (err: any) {
      logError("Schedule route failed", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // Metrics synchronization
  if (url.pathname === "/metrics/sync" && req.method === "POST") {
    try {
      const startDate = parseCalendarDate(url.searchParams.get("startDate"));
      const endDateExclusive = parseCalendarDate(url.searchParams.get("endDateExclusive"));
      const startTime = url.searchParams.get("startTime") || "";
      const endTimeExclusive = url.searchParams.get("endTimeExclusive") || "";
      const timeZone = url.searchParams.get("timeZone") || "";
      const platform = url.searchParams.get("platform") || undefined;
      let validTimeZone = true;
      try { new Intl.DateTimeFormat("en", { timeZone }).format(); } catch { validTimeZone = false; }
      if (!startDate || !endDateExclusive || !Number.isFinite(Date.parse(startTime)) || !Number.isFinite(Date.parse(endTimeExclusive)) || !validTimeZone) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Valid calendar dates and exact range boundaries are required." }));
        return;
      }
      const startMs = Date.parse(`${startDate}T00:00:00.000Z`);
      const endMs = Date.parse(`${endDateExclusive}T00:00:00.000Z`);
      const rangeDays = (endMs - startMs) / 86_400_000;
      const exactRangeMs = Date.parse(endTimeExclusive) - Date.parse(startTime);
      if (rangeDays <= 0 || rangeDays > MAX_METRICS_SYNC_DAYS || exactRangeMs <= 0 || exactRangeMs > (MAX_METRICS_SYNC_DAYS + 1) * 86_400_000) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Metrics sync range must be between 1 and ${MAX_METRICS_SYNC_DAYS} days.` }));
        return;
      }
      if (platform && !METRICS_SYNC_PLATFORMS.has(platform)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "platform must be one of ig, th, fb, or yt." }));
        return;
      }

      // Build metric providers for each platform
      const providers = new Map<string, any>();

      // Instagram
      const igUserId = process.env.IG_USER_ID || "";
      const igToken = process.env.IG_ACCESS_TOKEN || "";
      if (igUserId && igToken) {
        providers.set("ig", new InstagramMetricsProvider(igToken, igUserId));
      } else {
        logWarn("Instagram credentials not configured — Instagram metrics will be skipped");
      }

      // Threads
      const thUserId = process.env.THREADS_USER_ID || "";
      const thToken = process.env.THREAD_ACCESS_TOKEN || "";
      if (thUserId && thToken) {
        providers.set("th", new ThreadsMetricsProvider(thToken, thUserId));
      } else {
        logWarn("Threads credentials not configured — Threads metrics will be skipped");
      }

      // YouTube
      const ytToken = process.env.YOUTUBE_REFRESH_TOKEN || "";
      const ytClientId = process.env.YOUTUBE_CLIENT_ID || "";
      const ytClientSecret = process.env.YOUTUBE_CLIENT_SECRET || "";
      if (ytToken && ytClientId && ytClientSecret) {
        providers.set("yt", new YouTubeMetricsProvider());
      } else {
        logWarn("YouTube credentials not fully configured — YouTube metrics will be skipped");
      }

      // Facebook
      const fbPageId = process.env.META_PAGE_ID || "";
      const fbPageToken = process.env.META_PAGE_ACCESS_TOKEN || "";
      if (fbPageId && fbPageToken) {
        providers.set("fb", new FacebookMetricsProvider(fbPageToken, fbPageId));
      } else {
        logWarn("Facebook credentials not configured — Facebook metrics will be skipped");
      }

      const service = new SyncMetricsService(providers, 5);
      const report = await service.syncAll({
        startDate,
        endDateExclusive,
        startTime: new Date(startTime).toISOString(),
        endTimeExclusive: new Date(endTimeExclusive).toISOString(),
        timeZone,
        platform: platform as "ig" | "th" | "fb" | "yt" | undefined,
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(report));
      logInfo(`Metrics sync endpoint executed`, {
        discovered: report.summary.discovered,
        updated: report.summary.updated,
        failed: report.summary.failed,
      });
    } catch (err: any) {
      logError("Metrics sync endpoint failed", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Metrics synchronization could not be completed." }));
    }
    return;
  }

  // Verify Facebook page access
  if (url.pathname === "/verify-facebook" && req.method === "GET") {
    try {
      const { FacebookGraphClient } = await import("./lib/facebook");
      const client = new FacebookGraphClient({
        pageId: process.env.META_PAGE_ID || "",
        pageAccessToken: process.env.META_PAGE_ACCESS_TOKEN || "",
      });
      const verified = await client.verifyPageAccess();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ verified }));
    } catch (err: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ verified: false, error: err.message }));
    }
    return;
  }

  // 404
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

// ── Start ──

async function start() {
  if (!validateConfig()) {
    process.exit(1);
  }

  try {
    // Verify Supabase connection
    const { data: supabaseCheck } = await supabaseServer.from("posts").select("count").limit(1);
    logInfo("Connected to Supabase successfully");
  } catch (err: any) {
    logError("Failed to connect to Supabase", { error: err.message });
    process.exit(1);
  }

  server.listen(Number(PORT), HOST, () => {
    logInfo(`Social Poster Backend Server running on port ${PORT}`);
    logInfo(`Health check: GET http://${HOST}:${PORT}/health`);
    logInfo("All non-health routes require the owner bearer token");
  });
}

start().catch((err) => {
  logError("Failed to start server", { error: err.message });
  process.exit(1);
});
