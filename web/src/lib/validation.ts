// src/lib/validation.ts
// Validation and normalization for imported/external data.
// Creates a clear boundary between external/imported data and the internal Post model.

import type { Platform, Post, PostStatus } from "../types/post";
import { FIELD_SCHEMA, CONTENT_TYPES } from "./contentTypes";

export interface ValidationResult {
  valid: boolean;
  post: Post | null;
  errors: string[];
  warnings: string[];
}

export interface BulkValidationResult {
  items: Post[];
  errors: string[];
  warnings: string[];
}

// ── ID Generation ──
export function generateId(): string {
  return "p_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

// Convert the date/time fields used by the planner into the timestamp consumed
// by the publishing backend. The browser's local timezone is intentional: the
// form represents the user's local calendar time and Supabase stores UTC.
export function buildScheduledAt(date: string, time: string): string | undefined {
  if (!date || !time) return undefined;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

// ── Normalization ──

export function normalizePost(p: any): Post {
  const post = { ...p };
  if (!post.id) post.id = generateId();
  if (!post.createdAt) post.createdAt = Date.now().toString();
  if (!post.updatedAt) post.updatedAt = Date.now().toString();
  if (!post.contentType && post.type) post.contentType = post.type;
  // Ensure flat metric fields are present
  if (post.views === undefined && post.likes === undefined && post.comments === undefined) {
    const m = post.metrics || {};
    post.views = m.views ?? 0;
    post.likes = m.likes ?? 0;
    post.comments = m.comments ?? 0;
  }
  // Remove the nested metrics object — Post type uses flat fields
  delete post.metrics;
  delete post.metricsUpdatedAt;
  return post as Post;
}

// ── Single Post Validation ──

export function validatePost(input: any, platform?: Platform): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { valid: false, post: null, errors: ["Item must be an object."], warnings: [] };
  }

  // Required fields
  if (!input.platform) errors.push("platform is required.");
  else if (!CONTENT_TYPES[input.platform as Platform]) errors.push(`Invalid platform "${input.platform}".`);

  if (!input.date) errors.push("date is required.");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) errors.push("date must be in YYYY-MM-DD format.");

  // Validate platform-specific fields if platform is known
  const plat = input.platform as Platform || platform;
  if (plat && FIELD_SCHEMA[plat]) {
    const schema = FIELD_SCHEMA[plat];
    schema.forEach((f) => {
      if (f.key === "contentType" && (!input.contentType || String(input.contentType).trim() === "")) {
        errors.push("contentType is required.");
      }
      if (f.type === "select" && input[f.key] !== undefined && f.options && !f.options.includes(String(input[f.key]))) {
        errors.push(`${f.key} must be one of ${f.options.join(", ")}`);
      }
      if (f.type !== "select" && input[f.key] !== undefined && typeof input[f.key] !== "string") {
        errors.push(`${f.key} must be text.`);
      }
    });
  }

  // Validate metrics if present
  if (input.metrics !== undefined) {
    if (!input.metrics || typeof input.metrics !== "object" || Array.isArray(input.metrics)) {
      errors.push("metrics must be an object.");
    } else {
      ["views", "likes", "comments"].forEach((m) => {
        const v = input.metrics[m];
        if (v !== undefined && v !== null && v !== "" && (!Number.isFinite(Number(v)) || Number(v) < 0)) {
          errors.push(`${m} must be a non-negative number.`);
        }
      });
    }
  }

  // Validate time if present
  if (input.time !== undefined && input.time !== "" && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    errors.push("time must use HH:MM (24-hour) format.");
  }

  // Validate status if present
  const validStatuses: PostStatus[] = ["draft", "scheduled", "publishing", "published", "failed"];
  if (input.status !== undefined && !validStatuses.includes(input.status as PostStatus)) {
    errors.push(`status must be one of ${validStatuses.join(", ")}.`);
  }
  if (input.status === "scheduled" && !buildScheduledAt(String(input.date || ""), String(input.time || ""))) {
    errors.push("scheduled posts require a valid date and time.");
  }

  const valid = errors.length === 0;
  const post = valid ? normalizePost(input) : null;

  return { valid, post, errors, warnings };
}

// ── Bulk Parse/Validate/Normalize ──

export function parseImportedPosts(raw: string): BulkValidationResult {
  const result: BulkValidationResult = { items: [], errors: [], warnings: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    result.errors.push("Invalid JSON: " + (e instanceof Error ? e.message : "Could not parse."));
    return result;
  }

  if (!Array.isArray(parsed)) {
    result.errors.push("The JSON root must be an array of posts.");
    return result;
  }

  if (parsed.length === 0) {
    result.errors.push("The JSON file contains no posts.");
    return result;
  }

  // Detect if all items have the same platform, or if platform is specified per-item
  const platformSet = new Set<string>();
  parsed.forEach((item) => { if (item?.platform) platformSet.add(String(item.platform)); });

  const dominantPlatform = platformSet.size === 1 ? (Array(platformSet)[0] as unknown as Platform) : undefined;

  (parsed as any[]).forEach((item, idx) => {
    const n = idx + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      result.errors.push(`Row ${n}: each item must be an object.`);
      return;
    }
    if (!item.date) result.errors.push(`Row ${n}: date is required.`);
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date))) result.errors.push(`Row ${n}: date must be in YYYY-MM-DD format.`);
    if (!item.platform) result.errors.push(`Row ${n}: platform is required.`);
    else if (!CONTENT_TYPES[item.platform as Platform]) result.errors.push(`Row ${n}: Invalid platform "${item.platform}".`);

    const validation = validatePost(item);
    result.errors.push(...validation.errors);
    result.warnings.push(...validation.warnings);

    if (validation.post) {
      result.items.push(validation.post);
    }
  });

  // Check for duplicates within the import
  const seen = new Map<string, number>();
  result.items.forEach((post, idx) => {
    const key = post.sourceId ? `sourceId|${post.sourceId}` : post.permalink ? `permalink|${post.permalink}` : `content|${post.date}|${post.platform}|${post.contentType}`;
    if (seen.has(key)) {
      result.warnings.push(`Row ${idx + 1}: duplicate of row ${seen.get(key)}.`);
      // Remove the duplicate
      result.items.splice(idx, 1);
    } else {
      seen.set(key, idx + 1);
    }
  });

  return result;
}

// ── Normalize imported item to internal Post model ──

export function normalizeImportedItem(item: any, platform?: Platform): Post {
  const normalized = normalizePost(item);
  // Ensure platform matches the expected platform for bulk import
  if (platform && !normalized.platform) {
    normalized.platform = platform;
  }
  return normalized;
}
