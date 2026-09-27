// src/lib/contentTypes.ts
import type { Platform } from "../types/post";

export const CONTENT_TYPES: Record<Platform, string[]> = {
  yt: ["Video", "Short", "Live", "Community Post", "Other"],
  ig: ["Reel", "Post", "Carousel", "Story", "Live", "Other"],
  fb: ["Reel", "Video", "Image", "Text", "Story", "Link", "Other"],
  th: ["Text", "Image", "Video", "GIF", "Link", "Other"],
  li: ["Text", "Image", "Video", "Document", "Article", "Poll", "Event", "Other"],
  x: ["Text", "Image", "Video", "GIF", "Link", "Thread", "Other"],
};

export const FIELD_SCHEMA: Record<Platform, { key: string; label: string; type: "text" | "textarea" | "select"; options?: string[] }[]> = {
  yt: [
    { key: "contentType", label: "Content type", type: "select", options: CONTENT_TYPES.yt },
    { key: "title", label: "Title", type: "text" },
    { key: "description", label: "Description", type: "textarea" },
  ],
  ig: [
    { key: "contentType", label: "Content type", type: "select", options: CONTENT_TYPES.ig },
    { key: "topic", label: "Topic name", type: "text" },
    { key: "caption", label: "Caption", type: "textarea" },
  ],
  fb: [
    { key: "contentType", label: "Content type", type: "select", options: CONTENT_TYPES.fb },
    { key: "topic", label: "Topic name", type: "text" },
    { key: "content", label: "Content / Caption", type: "textarea" },
  ],
  th: [
    { key: "contentType", label: "Content type", type: "select", options: CONTENT_TYPES.th },
    { key: "topic", label: "Topic name", type: "text" },
    { key: "content", label: "Content", type: "textarea" },
  ],
  li: [
    { key: "contentType", label: "Content type", type: "select", options: CONTENT_TYPES.li },
    { key: "topic", label: "Topic name", type: "text" },
    { key: "content", label: "Content", type: "textarea" },
  ],
  x: [
    { key: "contentType", label: "Content type", type: "select", options: CONTENT_TYPES.x },
    { key: "topic", label: "Topic name", type: "text" },
    { key: "content", label: "Content", type: "textarea" },
  ],
};

export const METRIC_FIELDS = [
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
];
