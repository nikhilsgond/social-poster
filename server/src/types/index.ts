// server/src/types/index.ts
// Shared types between the server and the frontend.
// Mirrors the frontend Post type from src/types/post.ts.
// This ensures the database schema and application model stay in sync.

export type Platform = "yt" | "ig" | "fb" | "th" | "li" | "x";

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "failed";

export interface Post {
  id: string;
  platform: Platform;
  contentType: string;
  title?: string;
  topic?: string;
  content?: string;
  description?: string;
  caption?: string;
  date: string;
  time: string;
  scheduledAt?: string;
  mediaUrl?: string | null;
  cloudinaryPublicId?: string | null;
  socialUrl?: string | null;
  mediaCleanedAt?: string | null;
  status: PostStatus;
  platformPostId?: string | null;
  errorMessage?: string | null;
  attempts?: number;
  publishedAt?: string | null;
  views?: number;
  likes?: number;
  comments?: number;
  metricsUpdatedAt?: string | null;
  sourceId?: string | null;
  permalink?: string | null;
  createdAt?: string;
  updatedAt?: string;
  carouselChildren?: string[];
}
