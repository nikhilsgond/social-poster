import { platformDataMap } from "../components/common/PlatformIcon";
import type { Platform, Post } from "../types/post";

export type ExportRangeDays = 7 | 30 | 90;
export type ExportRangeType = ExportRangeDays | "custom";

export interface ExportDateRange {
  type: ExportRangeType;
  from?: string;
  to?: string;
}

export interface ExportPostRecord {
  platform: string;
  contentType: string;
  title: string;
  topic: string;
  caption: string;
  content: string;
  description: string;
  status: string;
  scheduledAt: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  platformPostId: string;
  postUrl: string;
}

function validDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localCalendarBoundary(value: string | undefined, endOfDay: boolean): Date | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function canonicalPlannerDate(post: Post): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(post.date || "")) return null;
  const time = /^\d{2}:\d{2}/.test(post.time || "") ? post.time.slice(0, 5) : "00:00";
  return validDate(`${post.date}T${time}:00`);
}

export function getExportPostDate(post: Post): Date | null {
  if (post.status === "published") {
    const publishedAt = validDate(post.publishedAt);
    if (publishedAt) return publishedAt;
  }
  if (post.status === "scheduled") {
    const scheduledAt = validDate(post.scheduledAt);
    if (scheduledAt) return scheduledAt;
  }
  return canonicalPlannerDate(post);
}

export function filterPostsForExport(
  posts: Post[],
  platform: Platform | "all",
  range: ExportDateRange,
  now = new Date(),
): Post[] {
  const bounds = getExportRangeBounds(range, now);
  if (!bounds) return [];
  return posts.filter((post) => {
    if (platform !== "all" && post.platform !== platform) return false;
    const postDate = getExportPostDate(post);
    return postDate !== null && postDate >= bounds.start && postDate <= bounds.end;
  });
}

export function getExportRangeBounds(range: ExportDateRange, now = new Date()): { start: Date; end: Date } | null {
  if (range.type !== "custom") {
    return { start: new Date(now.getTime() - range.type * 86400000), end: now };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(range.to || "")) return null;
  const start = localCalendarBoundary(range.from, false);
  const end = localCalendarBoundary(range.to, true);
  if (!start || !end || start > end) return null;
  return { start, end };
}

function scheduledValue(post: Post): string {
  if (post.scheduledAt) return post.scheduledAt;
  if (!post.date) return "";
  return post.time ? `${post.date}T${post.time}` : post.date;
}

export function toExportRecords(posts: Post[]): ExportPostRecord[] {
  return posts.map((post) => ({
    platform: platformDataMap[post.platform].name,
    contentType: post.contentType || "",
    title: post.title || "",
    topic: post.topic || "",
    caption: post.caption || "",
    content: post.content || "",
    description: post.description || "",
    status: post.status,
    scheduledAt: scheduledValue(post),
    publishedAt: post.publishedAt || "",
    views: post.views ?? 0,
    likes: post.likes ?? 0,
    comments: post.comments ?? 0,
    shares: post.shares ?? 0,
    platformPostId: post.platformPostId || "",
    postUrl: post.socialUrl || post.permalink || "",
  }));
}

const CSV_COLUMNS: Array<[keyof ExportPostRecord, string]> = [
  ["platform", "Platform"],
  ["contentType", "Content Type"],
  ["title", "Title"],
  ["topic", "Topic"],
  ["caption", "Caption"],
  ["content", "Content"],
  ["description", "Description"],
  ["status", "Status"],
  ["scheduledAt", "Scheduled Date/Time"],
  ["publishedAt", "Published Date/Time"],
  ["views", "Views"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["shares", "Shares"],
  ["platformPostId", "Platform Post ID"],
  ["postUrl", "Post URL"],
];

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportRecordsToCSV(records: ExportPostRecord[]): string {
  const header = CSV_COLUMNS.map(([, label]) => csvCell(label)).join(",");
  const rows = records.map((record) => CSV_COLUMNS.map(([key]) => csvCell(record[key])).join(","));
  return [header, ...rows].join("\r\n");
}
