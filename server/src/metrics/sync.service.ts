// server/src/metrics/sync.service.ts
// Metrics synchronization service.
// Orchestrates fetching metrics from all platforms, updating current metrics
// in Supabase, and saving historical snapshots.
//
// Key design decisions:
// - Concurrency limit of 5 simultaneous API calls to respect rate limits.
// - Partial failure: one failed platform/post does not stop the sync.
// - Existing metrics are NEVER overwritten with null/zero on failure.
// - One snapshot per post per minute (upsert strategy to avoid duplicates).
//
// Part of Phase 1: Metrics Synchronization.

import { supabaseServer } from "../lib/supabase";
import { logInfo, logWarn, logError } from "../lib/logger";
import type { Post } from "../types";
import type {
  MetricProvider,
  MetricResult,
  PlatformSyncResult,
  SyncReport,
  FetchedMetrics,
  MetricsSyncScope,
} from "./interface";
import { updateMetrics } from "../posts";

// ── Concurrency limiter ──
// Limits the number of simultaneous API calls to avoid rate-limit issues.
class ConcurrencyLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private max: number;

  constructor(max: number) {
    this.max = max;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    // Wait until we have a slot
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      // Wake up the next waiting task
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

// ── Capture timestamp for this sync run (used for snapshot grouping) ──
// All snapshots created during this sync use the same captured_at minute
// boundary, so concurrent syncs within the same minute coalesce.
function minuteBoundary(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes())).toISOString();
}

// ── Upsert a metric snapshot ──
// Uses raw SQL to upsert based on the idx_snapshots_unique_minute unique index.
// One snapshot per post per minute — if a snapshot already exists for this
// post in this minute, update it instead of inserting a duplicate.
async function upsertSnapshot(
  postId: string,
  platform: string,
  capturedAt: string,
  metrics: FetchedMetrics,
  platformMetricsExtra?: Record<string, unknown>
): Promise<void> {
  const capturedAtIso = new Date(capturedAt).toISOString();
  const platformMetricsJson = platformMetricsExtra
    ? JSON.stringify(platformMetricsExtra)
    : metrics.platformMetrics
      ? JSON.stringify(metrics.platformMetrics)
      : null;

  // Build the snapshot values
  const views = metrics.views ?? 0;
  const likes = metrics.likes ?? 0;
  const comments = metrics.comments ?? 0;
  const shares = metrics.shares ?? 0;

  // Use raw SQL upsert with the idx_snapshots_unique_minute unique index
  const { error } = await supabaseServer.rpc("upsert_metric_snapshot_raw", {
    p_post_id: postId,
    p_platform: platform,
    p_captured_at: capturedAtIso,
    p_views: views,
    p_likes: likes,
    p_comments: comments,
    p_shares: shares,
    p_platform_metrics: platformMetricsJson,
  });

  if (error) {
    // If the RPC doesn't exist (migration not applied or not available),
    // fall back to a simple insert
    logWarn(`Snapshot RPC unavailable, falling back to insert for post ${postId}`, {
      error: error.message,
      note: "Run the migration SQL to enable upserts with duplicate protection.",
    });

    const { error: insertError } = await supabaseServer
      .from("post_metric_snapshots")
      .insert({
        post_id: postId,
        platform,
        captured_at: capturedAtIso,
        views,
        likes,
        comments,
        shares,
        platform_metrics: platformMetricsJson,
      })
      .select()
      .single();

    if (insertError) {
      logError(`Snapshot insert failed for post ${postId}`, { error: insertError.message });
    }
  }
}

// ── SyncMetricsService ──
export class SyncMetricsService {
  private concurrencyLimit: number;
  private providers: Map<string, MetricProvider>;

  constructor(providers: Map<string, MetricProvider>, concurrencyLimit = 5) {
    this.providers = providers;
    this.concurrencyLimit = concurrencyLimit;
  }

  async syncAll(scope?: MetricsSyncScope): Promise<SyncReport> {
    const startedAt = new Date().toISOString();
    const capturedAt = minuteBoundary();

    const report: SyncReport = {
      success: true,
      startedAt,
      completedAt: "",
      summary: {
        postsFound: 0,
        postsUpdated: 0,
        postsFailed: 0,
      },
      platforms: {},
      errors: [],
    };

    logInfo(`Metrics sync started`, { capturedAt, concurrencyLimit: this.concurrencyLimit });

    // ── Step 1: Fetch all published posts with platform_post_id ──
    let posts: Post[];
    try {
      let query = supabaseServer
        .from("posts")
        .select("*")
        .eq("status", "published")
        .not("platform_post_id", "is", null)
        .order("published_at", { ascending: true });

      if (scope) {
        query = query.gte("date", scope.startDate).lt("date", scope.endDateExclusive);
        if (scope.platform) query = query.eq("platform", scope.platform);
      }

      const { data, error } = await query;

      if (error) throw error;
      posts = (data || []).map((row: any) => ({
        id: row.id,
        platform: row.platform,
        contentType: row.content_type,
        title: row.title ?? undefined,
        topic: row.topic ?? undefined,
        content: row.content ?? undefined,
        description: row.description ?? undefined,
        caption: row.caption ?? undefined,
        date: row.date,
        time: row.time,
        scheduledAt: row.scheduled_at ?? undefined,
        mediaUrl: row.media_url ?? null,
        cloudinaryPublicId: row.cloudinary_public_id ?? null,
        socialUrl: row.social_url ?? null,
        mediaCleanedAt: row.media_cleaned_at ?? null,
        status: row.status,
        platformPostId: row.platform_post_id ?? null,
        errorMessage: row.error_message ?? null,
        attempts: row.attempts ?? 0,
        publishedAt: row.published_at ?? null,
        views: row.views ?? 0,
        likes: row.likes ?? 0,
        comments: row.comments ?? 0,
        metricsUpdatedAt: row.metrics_updated_at ?? null,
        sourceId: row.source_id ?? null,
        permalink: row.permalink ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } catch (err: any) {
      const msg = "Eligible planner posts could not be loaded for metrics synchronization.";
      logError("Failed to fetch published posts for metrics synchronization", { error: err.message });
      report.success = false;
      report.errors.push(msg);
      report.completedAt = new Date().toISOString();
      return report;
    }

    report.summary.postsFound = posts.length;
    logInfo(`Metrics sync: found ${posts.length} published posts with platform_post_id`);

    if (posts.length === 0) {
      report.completedAt = new Date().toISOString();
      return report;
    }

    // Load the latest known snapshot once for each eligible post. Provider
    // responses may be partial, so new snapshots are based on this known state.
    const latestSnapshots = new Map<string, {
      shares: number;
      platformMetrics: Record<string, unknown>;
    }>();
    try {
      const { data, error } = await supabaseServer
        .from("post_metric_snapshots")
        .select("post_id, shares, platform_metrics, captured_at")
        .in("post_id", posts.map((post) => post.id))
        .order("captured_at", { ascending: false });
      if (error) throw error;
      for (const row of data || []) {
        if (latestSnapshots.has(row.post_id)) continue;
        let rawPlatformMetrics = row.platform_metrics;
        if (typeof rawPlatformMetrics === "string") {
          try { rawPlatformMetrics = JSON.parse(rawPlatformMetrics); }
          catch { rawPlatformMetrics = {}; }
        }
        latestSnapshots.set(row.post_id, {
          shares: Number(row.shares) || 0,
          platformMetrics: rawPlatformMetrics && typeof rawPlatformMetrics === "object"
            ? rawPlatformMetrics as Record<string, unknown>
            : {},
        });
      }
    } catch (err: any) {
      logWarn("Could not load prior metric snapshots; common post metrics will still be preserved", {
        error: err.message,
      });
    }

    // ── Step 2: Group posts by platform ──
    const byPlatform = new Map<string, Post[]>();
    for (const post of posts) {
      const list = byPlatform.get(post.platform) || [];
      list.push(post);
      byPlatform.set(post.platform, list);
    }

    // ── Step 3: Sync each platform ──
    const limiter = new ConcurrencyLimiter(this.concurrencyLimit);

    for (const [platform, platformPosts] of byPlatform) {
      const provider = this.providers.get(platform);

      if (!provider) {
        const msg = `Metrics are unavailable because ${platform} credentials are not configured.`;
        logWarn(msg);
        report.platforms[platform as keyof SyncReport["platforms"]] = {
          found: platformPosts.length,
          updated: 0,
          failed: platformPosts.length,
          unavailable: true,
          errors: [msg],
        };
        report.summary.postsFailed += platformPosts.length;
        report.errors.push(msg);
        continue;
      }

      // Check if the provider/platform is available
      let providerAvailable = true;
      try {
        const available = provider.isAvailable();
        providerAvailable = available === true || (typeof available === "boolean" ? available : await available);
      } catch {
        providerAvailable = true; // Assume available if we can't check
      }

      const platformResult: PlatformSyncResult = {
        found: platformPosts.length,
        updated: 0,
        failed: 0,
        errors: [],
      };

      if (!providerAvailable) {
        platformResult.unavailable = true;
        const msg = `Platform ${platform} metrics unavailable (permission/missing scope)`;
        logWarn(msg);
        platformResult.errors.push(msg);
        platformResult.failed = platformPosts.length;
        report.summary.postsFailed += platformPosts.length;
        report.errors.push(msg);
        report.platforms[platform as keyof SyncReport["platforms"]] = platformResult;
        continue;
      }

      // ── Step 4: Fetch metrics for each post (with concurrency limit) ──
      const tasks = platformPosts.map((post) =>
        limiter.run(async () => {
          const result = await provider.fetchMetrics(post);
          return { post, result };
        })
      );

      const results = await Promise.all(tasks);

      // ── Step 5: Process results ──
      for (const { post, result } of results) {
        if (result.success && result.metrics) {
          // Update current metrics in posts table (views, likes, comments only — not shares)
          try {
            const updatedPost = await updateMetrics(post.id, result.metrics);
            const previousSnapshot = latestSnapshots.get(post.id);
            const effectiveMetrics: FetchedMetrics = {
              views: result.metrics.views ?? updatedPost?.views ?? post.views ?? 0,
              likes: result.metrics.likes ?? updatedPost?.likes ?? post.likes ?? 0,
              comments: result.metrics.comments ?? updatedPost?.comments ?? post.comments ?? 0,
              shares: result.metrics.shares ?? previousSnapshot?.shares ?? 0,
              platformMetrics: {
                ...(previousSnapshot?.platformMetrics || {}),
                ...(result.metrics.platformMetrics || {}),
              },
            };

            try {
              await upsertSnapshot(
                post.id,
                platform,
                capturedAt,
                effectiveMetrics,
                Object.keys(effectiveMetrics.platformMetrics || {}).length > 0
                  ? effectiveMetrics.platformMetrics
                  : undefined
              );
            } catch (snapErr: any) {
              // Snapshot failure is non-fatal because current metrics are saved.
              logError(`Failed to save snapshot for post ${post.id}`, { error: snapErr.message });
              platformResult.errors.push(`Post ${post.id.slice(0, 8)}: snapshot could not be saved.`);
            }
          } catch (dbErr: any) {
            logError(`Failed to update metrics for post ${post.id}`, { error: dbErr.message });
            platformResult.failed++;
            report.summary.postsFailed++;
            platformResult.errors.push(`Post ${post.id.slice(0, 8)}: metrics could not be saved.`);
            continue;
          }

          platformResult.updated++;
          report.summary.postsUpdated++;
        } else {
          // Failed or platform unavailable
          platformResult.failed++;

          if (result.platformUnavailable) {
            platformResult.unavailable = true;
            report.summary.postsFailed++;
            platformResult.errors.push(`Metrics permissions are unavailable for ${platform}.`);
            report.errors.push(`Metrics permissions are unavailable for ${platform}.`);
          } else {
            report.summary.postsFailed++;
            const postRef = post.id.slice(0, 8);
            platformResult.errors.push(`Post ${postRef}: metrics could not be fetched.`);
            report.errors.push(`${platform}/${postRef}: metrics could not be fetched.`);
          }

          logError(`Metrics sync failed for post`, {
            postId: post.id,
            platform,
            error: result.error,
          });
        }
      }

      report.platforms[platform as keyof SyncReport["platforms"]] = platformResult;

    logInfo(`Platform ${platform} sync complete`, {
        found: platformResult.found,
        updated: platformResult.updated,
        failed: platformResult.failed,
        unavailable: platformResult.unavailable,
      });
    }

    report.completedAt = new Date().toISOString();

    logInfo(`Metrics sync completed`, {
      postsFound: report.summary.postsFound,
      postsUpdated: report.summary.postsUpdated,
      postsFailed: report.summary.postsFailed,
    });

    return report;
  }
}
