// src/lib/supabasePosts.ts
// Database repository layer — all Supabase operations go through here.
// UI → PostContext → supabasePosts.ts → Supabase
// This keeps all database code centralized and out of components.

import { supabase } from "./supabase";
import type { Post } from "../types/post";
import { normalizePost } from "./validation";

// ── Database Row → Application Post ──
// Maps Supabase snake_case columns to the application's camelCase Post model.

function dbRowToPost(row: any): Post {
  return normalizePost({
    id: row.id,
    platform: row.platform,
    contentType: row.content_type,
    title: row.title,
    topic: row.topic,
    content: row.content,
    description: row.description,
    caption: row.caption,
    date: row.date,
    time: row.time,
    scheduledAt: row.scheduled_at,
    mediaUrl: row.media_url,
    cloudinaryPublicId: row.cloudinary_public_id,
    socialUrl: row.social_url,
    mediaCleanedAt: row.media_cleaned_at,
    status: row.status,
    platformPostId: row.platform_post_id,
    errorMessage: row.error_message,
    attempts: row.attempts,
    publishedAt: row.published_at,
    views: row.views ?? 0,
    likes: row.likes ?? 0,
    comments: row.comments ?? 0,
    metricsUpdatedAt: row.metrics_updated_at,
    sourceId: row.source_id,
    permalink: row.permalink,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

// ── Application Post → Supabase Row ──
// Maps the application's camelCase Post to database snake_case columns.

function postToDbRow(post: Post | Omit<Post, "id" | "createdAt" | "updatedAt">): any {
  return {
    platform: post.platform,
    content_type: post.contentType,
    title: post.title ?? null,
    topic: post.topic ?? null,
    content: post.content ?? null,
    description: post.description ?? null,
    caption: post.caption ?? null,
    date: post.date,
    time: post.time ?? "00:00:00",
    scheduled_at: post.scheduledAt ? new Date(post.scheduledAt).toISOString() : null,
    media_url: post.mediaUrl ?? null,
    cloudinary_public_id: post.cloudinaryPublicId ?? null,
    social_url: post.socialUrl ?? null,
    media_cleaned_at: post.mediaCleanedAt ? new Date(post.mediaCleanedAt).toISOString() : null,
    status: post.status,
    platform_post_id: post.platformPostId ?? null,
    error_message: post.errorMessage ?? null,
    attempts: post.attempts ?? 0,
    published_at: post.publishedAt ? new Date(post.publishedAt).toISOString() : null,
    views: post.views ?? 0,
    likes: post.likes ?? 0,
    comments: post.comments ?? 0,
    metrics_updated_at: post.metricsUpdatedAt ? new Date(post.metricsUpdatedAt).toISOString() : null,
    source_id: post.sourceId ?? null,
    permalink: post.permalink ?? null,
  };
}

// ── Repository Functions ──

export async function fetchPosts(): Promise<Post[]> {
  const { data, error } = await supabase.from("posts").select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(dbRowToPost);
}

export async function fetchPost(id: string): Promise<Post | null> {
  const { data, error } = await supabase.from("posts").select("*").eq("id", id).single();
  if (error) return null;
  return dbRowToPost(data);
}

export async function createPost(post: Omit<Post, "id" | "createdAt" | "updatedAt">): Promise<Post> {
  const row = postToDbRow(post);
  const { data, error } = await supabase.from("posts").insert(row).select().single();
  if (error) throw error;
  return dbRowToPost(data);
}

export async function createPosts(posts: Omit<Post, "id" | "createdAt" | "updatedAt">[]): Promise<Post[]> {
  const rows = posts.map(postToDbRow);
  const { data, error } = await supabase.from("posts").insert(rows).select();
  if (error) throw error;
  return (data || []).map(dbRowToPost);
}

export async function updatePost(id: string, changes: Partial<Post>): Promise<Post | null> {
  const row = postToDbRow(changes as Post);
  const { data, error } = await supabase.from("posts").update(row).eq("id", id).select().single();
  if (error) throw error;
  return dbRowToPost(data);
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from("posts").delete().eq("id", id);
  if (error) throw error;
}

export async function movePost(id: string, newDate: string): Promise<Post | null> {
  const { data, error } = await supabase
    .from("posts")
    .update({ date: newDate, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return dbRowToPost(data);
}

// ── Helper ──

export function formatSupabaseError(error: any): string {
  if (error?.message) {
    const msg = error.message.toLowerCase();
    if (msg.includes("network") || msg.includes("fetch")) return "Network error. Please check your connection.";
    if (msg.includes("rls") || msg.includes("row level security")) return "Access denied. Please refresh and try again.";
    if (msg.includes("permission")) return "Permission denied.";
    return "Failed to complete the operation. Please try again.";
  }
  return "An unexpected error occurred.";
}
