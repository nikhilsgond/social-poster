// server/src/index.ts
// Social Poster Backend Server.
// HTTP server with health check, test mode, and real publishing.
// Independent of the React frontend.

import dotenv from "dotenv";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { supabaseServer } from "./lib/supabase";
import { logInfo, logError } from "./lib/logger";
import { runTestMode } from "./test-mode";
import { getDuePosts, getPostById, updatePublishingResult, updatePublishingError } from "./posts";
import { routePublisher } from "./platforms/router";

// Load environment variables from .env file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// Validate required environment variables
function validateConfig(): boolean {
  const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "META_PAGE_ID", "META_PAGE_ACCESS_TOKEN"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logError(`Missing required environment variables: ${missing.join(", ")}`);
    return false;
  }

  logInfo("Server configuration validated");
  return true;
}

// ── HTTP Server ──

const PORT = process.env.PORT || 3001;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Set CORS headers for development
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
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

  // Get due posts
  if (url.pathname === "/posts/due" && req.method === "GET") {
    try {
      const posts = await getDuePosts();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ posts }));
      logInfo(`GET /posts/due returned ${posts.length} posts`);
    } catch (err: any) {
      logError("Failed to get due posts", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
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
      const post = await getPostById(id!);
      if (!post) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post not found" }));
        return;
      }

      // Only publish if scheduled_at is in the past or not set
      const canPublish = !post.scheduledAt || new Date(post.scheduledAt) <= new Date();
      if (!canPublish) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post is scheduled for a future date. Use /schedule/{id} for native scheduling." }));
        return;
      }

      const result = await routePublisher(post);

      if (result.success) {
        // Update Supabase with the Facebook result
        try {
          await updatePublishingResult(
            id,
            result.platformPostId ?? "",
            result.socialUrl ?? ""
          );
        } catch (dbErr: any) {
          logError("Failed to update Supabase after publish", { error: dbErr.message });
        }
      } else {
        // Update Supabase with the error
        try {
          await updatePublishingError(id, result.error ?? "Publishing failed");
        } catch (dbErr: any) {
          logError("Failed to update Supabase error", { error: dbErr.message });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
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
      const post = await getPostById(id!);
      if (!post) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post not found" }));
        return;
      }

      // Only schedule if scheduled_at is in the future
      if (!post.scheduledAt || new Date(post.scheduledAt) <= new Date()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Post is not scheduled for a future date" }));
        return;
      }

      const result = await routePublisher(post);

      if (result.success) {
        // Update Supabase — keep status as scheduled since Facebook holds the post
        try {
          await supabaseServer
            .from("posts")
            .update({
              platform_post_id: result.platformPostId ?? "",
              social_url: result.socialUrl ?? "",
              status: "scheduled",
              updated_at: new Date().toISOString(),
            })
            .eq("id", id)
            .select()
            .single();
        } catch (dbErr: any) {
          logError("Failed to update Supabase after scheduling", { error: dbErr.message });
        }
      } else {
        try {
          await updatePublishingError(id, result.error ?? "Scheduling failed");
        } catch (dbErr: any) {
          logError("Failed to update Supabase error", { error: dbErr.message });
        }
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
      logInfo(`Schedule route executed for ${id}`, { success: result.success });
    } catch (err: any) {
      logError("Schedule route failed", { error: err.message });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
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

  server.listen(PORT, () => {
    logInfo(`Social Poster Backend Server running on port ${PORT}`);
    logInfo(`Health check: GET http://localhost:${PORT}/health`);
    logInfo(`Due posts: GET http://localhost:${PORT}/posts/due`);
    logInfo(`Test mode: POST http://localhost:${PORT}/test`);
    logInfo(`Publish post: POST http://localhost:${PORT}/publish/{id}`);
    logInfo(`Verify Facebook: GET http://localhost:${PORT}/verify-facebook`);
  });
}

start().catch((err) => {
  logError("Failed to start server", { error: err.message });
  process.exit(1);
});
