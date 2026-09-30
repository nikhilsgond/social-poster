import type { Post } from "../types/post";
import {
  PLATFORM_CAPABILITIES,
  getContentTypeCapability,
  validatePlatformPostCapability,
  type PublishingPlatform,
  type RequiredMediaType,
} from "./contentTypes";
import { buildScheduledAt } from "./validation";

export type CreateMediaType = "image" | "video";

export interface CreateMediaSource {
  url: string;
  type: CreateMediaType;
  identity: string;
  origin: "upload" | "url";
  publicId?: string;
  bytes?: number;
}

export interface DestinationOption {
  key: string;
  platform: PublishingPlatform;
  contentType: string;
  mediaType: RequiredMediaType;
}

export interface DestinationDraft extends DestinationOption {
  title: string;
  caption: string;
  content: string;
  description: string;
  date: string;
  time: string;
}

export interface DestinationValidation {
  scheduledAt?: string;
  errors: string[];
}

export type DestinationAction =
  | "planner-scheduled"
  | "facebook-native-scheduled"
  | "facebook-immediate"
  | "youtube-native-scheduled";

export interface DuplicateConflict {
  destinationKey: string;
  source: "current operation" | "existing planner";
  conflictingPostId?: string;
  message: string;
}

export interface DuplicateCandidate {
  destination: DestinationDraft;
  mediaUrl?: string | null;
}

export interface DestinationProcessResult {
  destinationKey: string;
  state: "queued" | "processing" | "success" | "failed";
  message: string;
  postId?: string;
  error?: string;
}

export function normalizeSourceIdentity(value: string): string {
  const trimmed = value.trim();
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return trimmed.toLowerCase().replace(/\s+/g, " ");
  }
}

export function compatibleDestinations(mediaType: CreateMediaType | null): DestinationOption[] {
  const requiredType: RequiredMediaType = mediaType || "none";
  return (Object.keys(PLATFORM_CAPABILITIES) as PublishingPlatform[]).flatMap((platform) =>
    PLATFORM_CAPABILITIES[platform].contentTypes
      .filter((contentType) => contentType.mediaType === requiredType)
      .map((contentType) => ({
        key: `${platform}:${contentType.name}`,
        platform,
        contentType: contentType.name,
        mediaType: contentType.mediaType,
      })),
  );
}

export function createDestinationDraft(option: DestinationOption, initialDate: string): DestinationDraft {
  return {
    ...option,
    title: "",
    caption: "",
    content: "",
    description: "",
    date: initialDate,
    time: "",
  };
}

export function validateDestination(
  destination: DestinationDraft,
  media: CreateMediaSource | null,
  now = Date.now(),
): DestinationValidation {
  const scheduledAt = buildScheduledAt(destination.date, destination.time);
  const capability = PLATFORM_CAPABILITIES[destination.platform];
  const validation = validatePlatformPostCapability({
    ...destination,
    mediaUrl: media?.url || null,
  });
  const errors = [...validation.errors];

  if (!destination.date) errors.push("Date is required.");
  if (!destination.time) errors.push("Time is required.");
  if (destination.date && destination.time && !scheduledAt) errors.push("Date and time are invalid.");
  if (destination.platform === "yt" && scheduledAt && new Date(scheduledAt).getTime() <= now) {
    errors.push("YouTube native scheduling requires a future date and time.");
  }
  if (
    destination.platform === "ig" &&
    destination.contentType === "Story Video" &&
    media?.bytes &&
    media.bytes > (capability.limits.storyVideoMaxBytes || Number.POSITIVE_INFINITY)
  ) {
    errors.push("Instagram Story Video exceeds the current 8 MB limit.");
  }

  return { scheduledAt, errors: Array.from(new Set(errors)) };
}

export function destinationAction(destination: DestinationDraft, scheduledAt: string): DestinationAction {
  if (destination.platform === "ig" || destination.platform === "th") return "planner-scheduled";
  if (destination.platform === "yt") return "youtube-native-scheduled";
  return new Date(scheduledAt).getTime() > Date.now()
    ? "facebook-native-scheduled"
    : "facebook-immediate";
}

export function destinationActionLabel(action: DestinationAction): string {
  switch (action) {
    case "planner-scheduled": return "Scheduled in planner; published by the due-post worker";
    case "facebook-native-scheduled": return "Native Facebook scheduling";
    case "facebook-immediate": return "Immediate Facebook publishing";
    case "youtube-native-scheduled": return "Native YouTube scheduling";
  }
}

function destinationText(destination: Pick<DestinationDraft, "title" | "caption" | "content" | "description">): string {
  return destination.title || destination.caption || destination.content || destination.description || "";
}

export function duplicateIdentity(
  destination: Pick<DestinationDraft, "platform" | "contentType" | "date" | "title" | "caption" | "content" | "description">,
  mediaUrl?: string | null,
): string | null {
  const capability = getContentTypeCapability(destination.platform, destination.contentType);
  if (!capability || !destination.date) return null;
  const source = mediaUrl
    ? normalizeSourceIdentity(mediaUrl)
    : normalizeSourceIdentity(destinationText(destination));
  if (!source) return null;
  return `${destination.platform}|${capability.name.toLowerCase()}|${source}|${destination.date}`;
}

function postAsDestination(post: Post): DestinationDraft | null {
  if (post.platform !== "ig" && post.platform !== "th" && post.platform !== "fb" && post.platform !== "yt") return null;
  const capability = getContentTypeCapability(post.platform, post.contentType);
  if (!capability) return null;
  return {
    key: `${post.platform}:${capability.name}`,
    platform: post.platform,
    contentType: capability.name,
    mediaType: capability.mediaType,
    title: post.title || "",
    caption: post.caption || "",
    content: post.content || "",
    description: post.description || "",
    date: post.date,
    time: post.time,
  };
}

export function findDuplicateConflicts(
  destinations: DestinationDraft[],
  media: CreateMediaSource | null,
  existingPosts: Post[],
): DuplicateConflict[] {
  return findDuplicateConflictsForCandidates(
    destinations.map((destination) => ({ destination, mediaUrl: media?.url })),
    existingPosts,
  );
}

export function findDuplicateConflictsForCandidates(
  candidates: DuplicateCandidate[],
  existingPosts: Post[],
): DuplicateConflict[] {
  const conflicts: DuplicateConflict[] = [];
  const seen = new Map<string, string>();
  const operationConflictKeys = new Set<string>();

  candidates.forEach(({ destination, mediaUrl }) => {
    const identity = duplicateIdentity(destination, mediaUrl);
    if (!identity) return;
    const first = seen.get(identity);
    if (first) {
      if (!operationConflictKeys.has(first)) {
        conflicts.push({
          destinationKey: first,
          source: "current operation",
          message: `Duplicates ${destination.key} in this Create Post operation.`,
        });
        operationConflictKeys.add(first);
      }
      conflicts.push({
        destinationKey: destination.key,
        source: "current operation",
        message: `Duplicates ${first} in this Create Post operation.`,
      });
      operationConflictKeys.add(destination.key);
    } else {
      seen.set(identity, destination.key);
    }
  });

  const existingIdentities = new Map<string, Post>();
  existingPosts
    .filter((post) => post.status === "scheduled" || post.status === "publishing" || post.status === "published")
    .forEach((post) => {
      const destination = postAsDestination(post);
      const identity = destination ? duplicateIdentity(destination, post.mediaUrl) : null;
      if (identity) existingIdentities.set(identity, post);
    });

  candidates.forEach(({ destination, mediaUrl }) => {
    const identity = duplicateIdentity(destination, mediaUrl);
    const existing = identity ? existingIdentities.get(identity) : undefined;
    if (!existing) return;
    conflicts.push({
      destinationKey: destination.key,
      source: "existing planner",
      conflictingPostId: existing.id,
      message: `Conflicts with existing ${existing.status} post ${existing.id}.`,
    });
  });

  return conflicts;
}

export function destinationToPost(
  destination: DestinationDraft,
  media: CreateMediaSource | null,
): Omit<Post, "id" | "createdAt" | "updatedAt"> {
  const validation = validateDestination(destination, media);
  if (!validation.scheduledAt || validation.errors.length) {
    throw new Error(validation.errors.join(" ") || "Destination schedule is invalid.");
  }
  return {
    platform: destination.platform,
    contentType: destination.contentType,
    title: destination.title || undefined,
    caption: destination.caption || undefined,
    content: destination.content || undefined,
    description: destination.description || undefined,
    date: destination.date,
    time: destination.time,
    scheduledAt: validation.scheduledAt,
    mediaUrl: media?.url || null,
    cloudinaryPublicId: media?.publicId || null,
    status: "scheduled",
  };
}

function probeElement(url: string, type: CreateMediaType): Promise<CreateMediaType> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Media probe timed out.")), 8000);
    if (type === "image") {
      const element = new Image();
      element.onload = () => { window.clearTimeout(timeout); resolve("image"); };
      element.onerror = () => { window.clearTimeout(timeout); reject(new Error("Not an accessible image.")); };
      element.src = url;
      return;
    }
    const element = document.createElement("video");
    element.preload = "metadata";
    element.onloadedmetadata = () => { window.clearTimeout(timeout); element.src = ""; resolve("video"); };
    element.onerror = () => { window.clearTimeout(timeout); element.src = ""; reject(new Error("Not an accessible video.")); };
    element.src = url;
  });
}

export async function validateRemoteMediaUrl(
  value: string,
  options: { allowMediaProbe?: boolean } = { allowMediaProbe: true },
): Promise<CreateMediaSource> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a valid public media URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Media URL must use http or https.");
  }

  let bytes: number | undefined;
  try {
    const response = await fetch(url.toString(), { method: "HEAD" });
    if (response.ok) {
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const contentLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(contentLength) && contentLength > 0) bytes = contentLength;
      if (contentType.startsWith("image/")) {
        return { url: url.toString(), type: "image", identity: normalizeSourceIdentity(url.toString()), origin: "url", bytes };
      }
      if (contentType.startsWith("video/")) {
        return { url: url.toString(), type: "video", identity: normalizeSourceIdentity(url.toString()), origin: "url", bytes };
      }
    }
  } catch {
    // Many public CDNs block browser HEAD/CORS. Fall through to media probing.
  }

  if (options.allowMediaProbe === false) {
    throw new Error("Remote media metadata could not be verified. The host must expose an image/video Content-Type to browser HEAD requests.");
  }

  try {
    const type = await Promise.any([probeElement(url.toString(), "image"), probeElement(url.toString(), "video")]);
    return { url: url.toString(), type, identity: normalizeSourceIdentity(url.toString()), origin: "url", bytes };
  } catch {
    throw new Error("The URL could not be verified as an accessible image or video.");
  }
}

export function sanitizeProcessError(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value || "Unknown error");
  return message
    .replace(/(access_token=)[^&\s]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/((?:authorization|api[_-]?key|owner[_-]?key|service[_-]?role[_-]?key)\s*[:=]\s*)[^,;\s]+/gi, "$1[redacted]")
    .slice(0, 500);
}
