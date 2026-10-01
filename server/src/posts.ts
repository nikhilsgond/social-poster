// server/src/posts.ts
// Server-side post query functions.
// Uses the server-side Supabase client (service-role key, bypasses RLS).

import { supabaseServer } from "./lib/supabase";
import type { Post } from "./types";
import { DatabaseError } from "./lib/errors";
import { NATIVE_SCHEDULING_PLATFORMS } from "./platform-capabilities";

const DUE_POST_WORKER_PLATFORMS = ["ig", "th"] as const;

// ── Get due posts (scheduled and past their scheduled time) ──

export async function getDuePosts(): Promise<Post[]> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabaseServer
      .from("posts")
      .select("*")
      .eq("status", "scheduled")
      .in("platform", DUE_POST_WORKER_PLATFORMS)
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", now)
      .order("scheduled_at", { ascending: true });

    if (error) throw new DatabaseError(error.message);
    return (data || []).map(normalizeRow);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Get post by ID ──

export async function getPostById(id: string): Promise<Post | null> {
  try {
    const { data, error } = await supabaseServer
      .from("posts")
      .select("*")
      .eq("id", id)
      .single();

    if (error) return null;
    return normalizeRow(data);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// Atomically claim one due post. Because status="scheduled" is part of the
// UPDATE predicate, only one concurrent worker can claim the row before the
// external platform call.
export async function claimDuePostForPublishing(id: string): Promise<Post | null> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabaseServer
      .from("posts")
      .update({ status: "publishing", updated_at: now, error_message: null })
      .eq("id", id)
      .eq("status", "scheduled")
      .in("platform", DUE_POST_WORKER_PLATFORMS)
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", now)
      .select()
      .maybeSingle();

    if (error) throw new DatabaseError(error.message);
    return data ? normalizeRow(data) : null;
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// Native scheduling uses the same atomic claim pattern and also requires an
// empty platform ID so an accepted Facebook/YouTube post is never resubmitted.
export async function claimPostForNativeScheduling(id: string): Promise<Post | null> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await supabaseServer
      .from("posts")
      .update({ status: "publishing", updated_at: now, error_message: null })
      .eq("id", id)
      .eq("status", "scheduled")
      .in("platform", NATIVE_SCHEDULING_PLATFORMS)
      .is("platform_post_id", null)
      .not("scheduled_at", "is", null)
      .gt("scheduled_at", now)
      .select()
      .maybeSingle();

    if (error) throw new DatabaseError(error.message);
    return data ? normalizeRow(data) : null;
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Update post status ──

export async function updatePostStatus(id: string, status: Post["status"]): Promise<Post | null> {
  try {
    const { data, error } = await supabaseServer
      .from("posts")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new DatabaseError(error.message);
    return normalizeRow(data);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Update publishing result ──

export async function updatePublishingResult(
  id: string,
  platformPostId: string,
  socialUrl: string
): Promise<Post | null> {
  try {
    const { data, error } = await supabaseServer
      .from("posts")
      .update({
        platform_post_id: platformPostId,
        social_url: socialUrl,
        status: "published",
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", id)
      .eq("status", "publishing")
      .select()
      .single();

    if (error) throw new DatabaseError(error.message);
    return normalizeRow(data);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Update publishing error ──

export async function updatePublishingError(id: string, errorMessage: string): Promise<Post | null> {
  try {
    const { data, error } = await supabaseServer
      .from("posts")
      .update({
        status: "failed",
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "publishing")
      .select()
      .single();

    if (error) throw new DatabaseError(error.message);
    return normalizeRow(data);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Update scheduling result (native platform scheduling) ──
// For platforms that handle future publication themselves (YouTube, Facebook).
// Stores platform_post_id and social_url, keeps status as "scheduled".
// Does NOT set published_at — the platform owns the actual publication time.

export async function updateSchedulingResult(
  id: string,
  platformPostId: string,
  socialUrl: string
): Promise<Post | null> {
  try {
    const { data, error } = await supabaseServer
      .from("posts")
      .update({
        platform_post_id: platformPostId,
        social_url: socialUrl,
        status: "scheduled",
        updated_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", id)
      .eq("status", "publishing")
      .select()
      .single();

    if (error) throw new DatabaseError(error.message);
    return normalizeRow(data);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Update current metrics (from sync service) ──
// Updates ONLY views, likes, comments, and metrics_updated_at.
// Does NOT modify status, platform_post_id, scheduled_at, or published_at.
// Does NOT add shares to posts (shares goes only in snapshots).
// Shared with the metrics sync service (Phase 1) and any future metric sources.

export async function updateMetrics(
  id: string,
  metrics: { views?: number | null; likes?: number | null; comments?: number | null }
): Promise<Post | null> {
  try {
    // Only update fields that are explicitly provided (non-null/non-undefined).
    // This preserves existing metrics when a provider returns partial or empty data.
    const updateObj: Record<string, unknown> = {
      metrics_updated_at: new Date().toISOString(),
    };
    if (metrics.views != null) updateObj.views = metrics.views;
    if (metrics.likes != null) updateObj.likes = metrics.likes;
    if (metrics.comments != null) updateObj.comments = metrics.comments;

    const { data, error } = await supabaseServer
      .from("posts")
      .update(updateObj)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new DatabaseError(error.message);
    return normalizeRow(data);
  } catch (err: any) {
    throw new DatabaseError(err.message);
  }
}

// ── Normalize database row to Post type ──

function normalizeRow(row: any): Post {
  return {
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
  };
}
