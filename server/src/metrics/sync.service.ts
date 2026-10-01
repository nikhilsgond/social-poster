import { supabaseServer } from "../lib/supabase";
import { logError, logInfo, logWarn } from "../lib/logger";
import type { Post } from "../types";
import type {
  DiscoveredPost,
  FetchedMetrics,
  MetricProvider,
  MetricsSyncPlatform,
  MetricsSyncScope,
  PlatformSyncResult,
  SyncReport,
} from "./interface";
import { mergeMetrics } from "./providers/shared";
import { dedupeDiscoveredPosts } from "./identity";

const PLATFORM_ORDER: MetricsSyncPlatform[] = ["ig", "th", "fb", "yt"];
const SYNC_DIAGNOSTICS = process.env.NODE_ENV !== "production" || process.env.METRICS_SYNC_DIAGNOSTICS === "true";

function logInstagramReconciliation(message: string, meta: Record<string, unknown>): void {
  if (SYNC_DIAGNOSTICS) logInfo(message, meta);
}

function minuteBoundary(): string {
  const now = new Date();
  now.setUTCSeconds(0, 0);
  return now.toISOString();
}

function normalizedPost(row: any): Post {
  return {
    id: row.id,
    platform: row.platform,
    contentType: row.content_type,
    title: row.title ?? undefined,
    content: row.content ?? undefined,
    description: row.description ?? undefined,
    caption: row.caption ?? undefined,
    date: row.date,
    time: row.time,
    scheduledAt: row.scheduled_at ?? undefined,
    mediaUrl: row.media_url ?? null,
    socialUrl: row.social_url ?? null,
    status: row.status,
    platformPostId: row.platform_post_id ?? null,
    publishedAt: row.published_at ?? null,
    views: Number(row.views) || 0,
    likes: Number(row.likes) || 0,
    comments: Number(row.comments) || 0,
    metricsUpdatedAt: row.metrics_updated_at ?? null,
    permalink: row.permalink ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function publicationParts(publishedAt: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(publishedAt));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "00";
  return { date: `${value("year")}-${value("month")}-${value("day")}`, time: `${value("hour")}:${value("minute")}:${value("second")}` };
}

function metadataRow(item: DiscoveredPost, timeZone: string): Record<string, unknown> {
  const { date, time } = publicationParts(item.publishedAt, timeZone);
  const row: Record<string, unknown> = {
    platform: item.platform,
    platform_post_id: item.platformPostId,
    content_type: item.contentType,
    date,
    time,
    status: "published",
    published_at: item.publishedAt,
    updated_at: new Date().toISOString(),
  };
  if (item.title !== undefined) row.title = item.title;
  if (item.content !== undefined) row.content = item.content;
  if (item.description !== undefined) row.description = item.description;
  if (item.caption !== undefined) row.caption = item.caption;
  if (item.mediaUrl !== undefined) row.media_url = item.mediaUrl;
  if (item.permalink !== undefined) {
    row.permalink = item.permalink;
    row.social_url = item.permalink;
  }
  return row;
}

async function upsertSnapshot(postId: string, platform: MetricsSyncPlatform, capturedAt: string, metrics: Required<Pick<FetchedMetrics, "views" | "likes" | "comments" | "shares">> & FetchedMetrics): Promise<void> {
  const snapshot = {
    post_id: postId,
    platform,
    captured_at: capturedAt,
    views: metrics.views,
    likes: metrics.likes,
    comments: metrics.comments,
    shares: metrics.shares,
    platform_metrics: metrics.platformMetrics && Object.keys(metrics.platformMetrics).length ? metrics.platformMetrics : null,
  };
  const { error: rpcError } = await supabaseServer.rpc("upsert_metric_snapshot_raw", {
    p_post_id: snapshot.post_id,
    p_platform: snapshot.platform,
    p_captured_at: snapshot.captured_at,
    p_views: snapshot.views,
    p_likes: snapshot.likes,
    p_comments: snapshot.comments,
    p_shares: snapshot.shares,
    p_platform_metrics: snapshot.platform_metrics,
  });
  if (!rpcError) return;

  logWarn("Snapshot RPC unavailable; using table upsert", { error: rpcError.message });
  const { error } = await supabaseServer
    .from("post_metric_snapshots")
    .upsert(snapshot, { onConflict: "post_id,captured_at" });
  if (error) throw error;
}

async function loadExisting(platform: MetricsSyncPlatform, ids: string[]): Promise<Map<string, Post>> {
  if (!ids.length) return new Map();
  const rows: any[] = [];
  for (let index = 0; index < ids.length; index += 500) {
    const { data, error } = await supabaseServer
      .from("posts")
      .select("*")
      .eq("platform", platform)
      .in("platform_post_id", ids.slice(index, index + 500));
    if (error) throw error;
    rows.push(...(data || []));
  }
  return new Map(rows.map((row) => [String(row.platform_post_id), normalizedPost(row)]));
}

async function loadLatestSnapshots(postIds: string[]): Promise<Map<string, { shares: number; platformMetrics: Record<string, unknown> }>> {
  if (!postIds.length) return new Map();
  const { data, error } = await supabaseServer
    .from("post_metric_snapshots")
    .select("post_id,shares,platform_metrics,captured_at")
    .in("post_id", postIds)
    .order("captured_at", { ascending: false });
  if (error) throw error;
  const latest = new Map<string, { shares: number; platformMetrics: Record<string, unknown> }>();
  for (const row of data || []) {
    if (latest.has(row.post_id)) continue;
    latest.set(row.post_id, {
      shares: Number(row.shares) || 0,
      platformMetrics: row.platform_metrics && typeof row.platform_metrics === "object" ? row.platform_metrics : {},
    });
  }
  return latest;
}

function emptyPlatformResult(): PlatformSyncResult {
  return { discovered: 0, added: 0, existing: 0, updated: 0, failed: 0, snapshotFailures: 0, errors: [] };
}

function addToSummary(report: SyncReport, result: PlatformSyncResult): void {
  report.summary.discovered += result.discovered;
  report.summary.added += result.added;
  report.summary.existing += result.existing;
  report.summary.updated += result.updated;
  report.summary.failed += result.failed;
  report.summary.snapshotFailures += result.snapshotFailures;
}

export class SyncMetricsService {
  constructor(private providers: Map<string, MetricProvider>, _concurrencyLimit = 5) {}

  async syncAll(scope: MetricsSyncScope): Promise<SyncReport> {
    const report: SyncReport = {
      success: true,
      startedAt: new Date().toISOString(),
      completedAt: "",
      summary: { discovered: 0, added: 0, existing: 0, updated: 0, failed: 0, snapshotFailures: 0 },
      platforms: {},
      errors: [],
    };
    const capturedAt = minuteBoundary();
    const platforms = scope.platforms?.length
      ? PLATFORM_ORDER.filter((platform) => scope.platforms!.includes(platform))
      : scope.platform ? [scope.platform] : PLATFORM_ORDER;

    for (const platform of platforms) {
      const result = emptyPlatformResult();
      report.platforms[platform] = result;
      const provider = this.providers.get(platform);
      if (!provider) {
        result.unavailable = true;
        result.errors.push("Platform credentials are not configured.");
        report.errors.push(`${platform}: platform credentials are not configured.`);
        report.success = false;
        addToSummary(report, result);
        continue;
      }

      try {
        if (!(await provider.isAvailable())) {
          result.unavailable = true;
          result.errors.push("Platform access is unavailable.");
          report.success = false;
          addToSummary(report, result);
          continue;
        }

        const seenIdentities = new Set<string>();
        let stopForPlatformFailure = false;
        const processBatch = async (batch: DiscoveredPost[]) => {
          const discovered = dedupeDiscoveredPosts(batch, seenIdentities);
          if (platform === "ig") {
            logInstagramReconciliation("Instagram reconciliation batch received", {
              received: batch.length,
              unique: discovered.length,
              duplicateIdentities: batch.length - discovered.length,
            });
          }
          if (!discovered.length) return;

          result.discovered += discovered.length;
          const existing = await loadExisting(platform, discovered.map((post) => post.platformPostId));
          result.existing += existing.size;

          for (const item of discovered) {
            if (existing.has(item.platformPostId)) {
              if (platform === "ig") logInstagramReconciliation("Instagram discovery matched existing row", { platformPostId: item.platformPostId });
              continue;
            }
            const insertRow = metadataRow(item, scope.timeZone);
            if (item.metrics?.views !== undefined) insertRow.views = item.metrics.views;
            if (item.metrics?.likes !== undefined) insertRow.likes = item.metrics.likes;
            if (item.metrics?.comments !== undefined) insertRow.comments = item.metrics.comments;
            if (item.metrics && Object.keys(item.metrics).length) insertRow.metrics_updated_at = new Date().toISOString();
            const { data, error } = await supabaseServer.from("posts").insert(insertRow).select().single();
            if (error) {
              if (error.code === "23505") {
                const raced = await loadExisting(platform, [item.platformPostId]);
                const post = raced.get(item.platformPostId);
                if (post) {
                  existing.set(item.platformPostId, post);
                  result.existing++;
                  continue;
                }
              }
              logError("Discovered post insert failed", { platform, platformPostId: item.platformPostId, error: error.message });
              result.failed++;
              result.errors.push("A discovered post could not be saved.");
              continue;
            }
            existing.set(item.platformPostId, normalizedPost(data));
            result.added++;
            if (platform === "ig") logInstagramReconciliation("Instagram discovered post inserted", { platformPostId: item.platformPostId, postId: data.id });
          }

          let latestSnapshots = new Map<string, { shares: number; platformMetrics: Record<string, unknown> }>();
          try {
            latestSnapshots = await loadLatestSnapshots([...existing.values()].map((post) => post.id));
          } catch (err: any) {
            logWarn("Prior snapshots could not be loaded", { platform, error: err.message });
          }

          for (const item of discovered) {
            const post = existing.get(item.platformPostId);
            if (!post) {
              if (platform === "ig") logInstagramReconciliation("Instagram discovered post skipped", { platformPostId: item.platformPostId, reason: "no reconciled database row" });
              continue;
            }
            if (stopForPlatformFailure) {
              result.failed++;
              continue;
            }

            let latestMetrics = item.metrics || {};
            if (!item.metricsComplete) {
              const fetched = await provider.fetchMetrics(post, item.metrics);
              if (!fetched.success) {
                if (platform === "ig") logInstagramReconciliation("Instagram discovered post metrics skipped", { platformPostId: item.platformPostId, postId: post.id, reason: fetched.error || "provider metrics fetch failed" });
                result.failed++;
                result.errors.push("Metrics could not be refreshed for a discovered post.");
                if (fetched.platformUnavailable) {
                  result.unavailable = true;
                  stopForPlatformFailure = true;
                }
                continue;
              }
              latestMetrics = mergeMetrics(item.metrics, fetched.metrics);
            }

            const prior = latestSnapshots.get(post.id);
            const effective = {
              views: latestMetrics.views ?? post.views ?? 0,
              likes: latestMetrics.likes ?? post.likes ?? 0,
              comments: latestMetrics.comments ?? post.comments ?? 0,
              shares: latestMetrics.shares ?? prior?.shares ?? 0,
              platformMetrics: {
                ...(prior?.platformMetrics || {}),
                ...(latestMetrics.platformMetrics || {}),
              },
            };

            const updateRow = metadataRow(item, scope.timeZone);
            updateRow.views = effective.views;
            updateRow.likes = effective.likes;
            updateRow.comments = effective.comments;
            updateRow.metrics_updated_at = new Date().toISOString();
            const { error: updateError } = await supabaseServer.from("posts").update(updateRow).eq("id", post.id);
            if (updateError) {
              logError("Discovered post reconciliation failed", { platform, platformPostId: item.platformPostId, postId: post.id, error: updateError.message });
              result.failed++;
              result.errors.push("A discovered post could not be updated.");
              continue;
            }

            try {
              await upsertSnapshot(post.id, platform, capturedAt, effective);
              result.updated++;
              if (platform === "ig") logInstagramReconciliation("Instagram discovered post reconciled", { platformPostId: item.platformPostId, postId: post.id, contentType: item.contentType });
            } catch (err: any) {
              logError("Metric snapshot persistence failed", { platform, postId: post.id, error: err.message });
              result.snapshotFailures++;
              result.failed++;
              result.errors.push("A metric snapshot could not be saved.");
            }
          }
        };

        const discovery = await provider.discoverPosts(scope, processBatch);
        if (!discovery.success) {
          result.unavailable = discovery.platformUnavailable;
          result.errors.push(discovery.error || "Platform discovery failed.");
          report.success = false;
        }
      } catch (err: any) {
        logError("Platform synchronization failed", { platform, error: err.message });
        result.errors.push("Platform synchronization could not be completed.");
        result.failed = Math.max(result.failed, result.discovered - result.updated);
      }

      addToSummary(report, result);
      if (result.failed || result.unavailable || result.errors.length) report.success = false;
      logInfo("Platform synchronization complete", { platform, ...result });
    }

    report.completedAt = new Date().toISOString();
    return report;
  }
}
