import type { Post } from "../types/post";
import {
  getContentTypeCapability,
  isPublishingPlatform,
  PLATFORM_CAPABILITIES,
  type PublishingPlatform,
} from "./contentTypes";
import {
  destinationAction,
  findDuplicateConflictsForCandidates,
  validateDestination,
  validateRemoteMediaUrl,
  multipleImagesSource,
  type CreateMediaSource,
  type DestinationAction,
  type DestinationDraft,
} from "./createPostWorkflow";

export const BULK_JSON_SCHEMA_VERSION = 1;
export const MAX_BULK_JSON_POSTS = 100;

const ROOT_FIELDS = new Set(["schemaVersion", "posts"]);
const POST_FIELDS = new Set([
  "platform", "contentType", "mediaUrl", "mediaUrls", "title", "caption", "content", "description", "date", "time",
]);

export const BULK_JSON_TEMPLATE = JSON.stringify({
  schemaVersion: BULK_JSON_SCHEMA_VERSION,
  posts: [
    {
      platform: "ig",
      contentType: "Image",
      mediaUrl: "https://res.cloudinary.com/example/image/upload/sample.jpg",
      caption: "Launch day",
      date: "2026-10-01",
      time: "09:30",
    },
    {
      platform: "th",
      contentType: "Text",
      content: "Launch day",
      date: "2026-10-01",
      time: "10:00",
    },
  ],
}, null, 2);

export interface BulkJsonPreviewRow {
  row: number;
  values: {
    platform: string;
    contentType: string;
    title: string;
    caption: string;
    content: string;
    description: string;
    date: string;
    time: string;
  };
  destination?: DestinationDraft;
  media: CreateMediaSource | null;
  mediaUrl: string;
  mediaUrls: string[];
  errors: string[];
  warnings: string[];
  action?: DestinationAction;
}

export interface BulkJsonValidationResult {
  rootErrors: string[];
  rows: BulkJsonPreviewRow[];
  valid: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(row: Record<string, unknown>, field: string, errors: string[]): string {
  const value = row[field];
  if (value === undefined) return "";
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return "";
  }
  return value.trim();
}

function validCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function addUnique(target: string[], values: string[]) {
  values.forEach((value) => {
    if (!target.includes(value)) target.push(value);
  });
}

export async function validateBulkJson(
  source: string,
  existingPosts: Post[],
  now = Date.now(),
): Promise<BulkJsonValidationResult> {
  const rootErrors: string[] = [];
  const rows: BulkJsonPreviewRow[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : "Invalid JSON.";
    return { rootErrors: [`JSON could not be parsed: ${detail}`], rows, valid: false };
  }

  if (!isPlainObject(parsed)) {
    return { rootErrors: ["The JSON root must be an object with schemaVersion and posts."], rows, valid: false };
  }

  const unknownRoot = Object.keys(parsed).filter((key) => !ROOT_FIELDS.has(key));
  if (unknownRoot.length) rootErrors.push(`Unknown root field(s): ${unknownRoot.join(", ")}.`);
  if (parsed.schemaVersion !== BULK_JSON_SCHEMA_VERSION) {
    rootErrors.push(`schemaVersion must be ${BULK_JSON_SCHEMA_VERSION}.`);
  }
  if (!Array.isArray(parsed.posts)) {
    rootErrors.push("posts must be an array.");
    return { rootErrors, rows, valid: false };
  }
  if (parsed.posts.length === 0) rootErrors.push("posts must contain at least one entry.");
  if (parsed.posts.length > MAX_BULK_JSON_POSTS) {
    rootErrors.push(`A bulk operation can contain at most ${MAX_BULK_JSON_POSTS} entries.`);
  }

  const mediaCache = new Map<string, Promise<CreateMediaSource>>();
  for (let index = 0; index < parsed.posts.length; index += 1) {
    const raw = parsed.posts[index];
    const preview: BulkJsonPreviewRow = {
      row: index + 1,
      values: { platform: "", contentType: "", title: "", caption: "", content: "", description: "", date: "", time: "" },
      media: null,
      mediaUrl: "",
      mediaUrls: [],
      errors: [],
      warnings: [],
    };
    rows.push(preview);

    if (!isPlainObject(raw)) {
      preview.errors.push("Entry must be an object.");
      continue;
    }
    const unknownFields = Object.keys(raw).filter((key) => !POST_FIELDS.has(key));
    if (unknownFields.length) preview.errors.push(`Unknown field(s): ${unknownFields.join(", ")}.`);

    const platformValue = stringField(raw, "platform", preview.errors);
    const contentTypeValue = stringField(raw, "contentType", preview.errors);
    const mediaUrl = stringField(raw, "mediaUrl", preview.errors);
    let mediaUrls: string[] | undefined;
    if (raw.mediaUrls !== undefined) {
      if (!Array.isArray(raw.mediaUrls) || raw.mediaUrls.some((item) => typeof item !== "string")) {
        preview.errors.push("mediaUrls must be an array of HTTP/HTTPS URL strings.");
      } else mediaUrls = raw.mediaUrls.map((item: string) => item.trim());
    }
    const title = stringField(raw, "title", preview.errors);
    const caption = stringField(raw, "caption", preview.errors);
    const content = stringField(raw, "content", preview.errors);
    const description = stringField(raw, "description", preview.errors);
    const date = stringField(raw, "date", preview.errors);
    const time = stringField(raw, "time", preview.errors);
    preview.values = { platform: platformValue, contentType: contentTypeValue, title, caption, content, description, date, time };
    preview.mediaUrl = mediaUrl;
    preview.mediaUrls = mediaUrls || [];

    if (!platformValue) preview.errors.push("platform is required.");
    if (!contentTypeValue) preview.errors.push("contentType is required.");
    if (!date) preview.errors.push("date is required.");
    else if (!validCalendarDate(date)) preview.errors.push("date must be a real calendar date in YYYY-MM-DD format.");
    if (!time) preview.errors.push("time is required.");
    else if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) preview.errors.push("time must use 24-hour HH:MM format.");

    if (!isPublishingPlatform(platformValue)) {
      if (platformValue) preview.errors.push("platform must be one of ig, th, fb, or yt.");
      continue;
    }

    const platform: PublishingPlatform = platformValue;
    const type = getContentTypeCapability(platform, contentTypeValue);
    if (!type) {
      if (contentTypeValue) {
        preview.errors.push(
          `contentType must be one of ${PLATFORM_CAPABILITIES[platform].contentTypes.map((item) => item.name).join(", ")} for ${PLATFORM_CAPABILITIES[platform].name}.`,
        );
      }
      continue;
    }
    if (contentTypeValue !== type.name) {
      preview.warnings.push(`Legacy contentType "${contentTypeValue}" is normalized to "${type.name}".`);
    }
    if (raw.mediaUrls !== undefined && !(platform === "fb" && type.multipleImages)) {
      preview.errors.push("mediaUrls is supported only for Facebook Multiple Images.");
    }
    if (type.multipleImages && mediaUrl) preview.errors.push("Multiple Images uses mediaUrls, not mediaUrl.");

    const destination: DestinationDraft = {
      key: `json-row-${index + 1}`,
      platform,
      contentType: type.name,
      mediaType: type.mediaType,
      ...(mediaUrls ? { mediaUrls } : {}),
      title,
      caption,
      content,
      description,
      date,
      time,
    };
    preview.destination = destination;

    const fieldValues = { title, caption, content, description } as const;
    (Object.keys(fieldValues) as Array<keyof typeof fieldValues>).forEach((field) => {
      if (fieldValues[field] && PLATFORM_CAPABILITIES[platform].fields[field] === "unsupported") {
        preview.errors.push(`${PLATFORM_CAPABILITIES[platform].name} ${type.name} does not support ${field}.`);
      }
    });
    if (type.mediaType === "none" && mediaUrl) {
      preview.errors.push(`${type.name} does not support media with the current publisher.`);
    }

    if (type.multipleImages && mediaUrls) {
      const items: CreateMediaSource[] = [];
      for (const url of mediaUrls) {
        let promise = mediaCache.get(url);
        if (!promise) {
          promise = validateRemoteMediaUrl(url, { allowMediaProbe: false });
          mediaCache.set(url, promise);
        }
        try {
          const item = await promise;
          items.push(item);
          if (item.type !== "image") preview.errors.push("Multiple Images cannot contain video URLs.");
        } catch (error) {
          preview.errors.push(error instanceof Error ? error.message : "Image URL could not be verified.");
        }
      }
      preview.media = multipleImagesSource(items);
    } else if (!type.multipleImages && type.mediaType !== "none" && mediaUrl) {
      let mediaPromise = mediaCache.get(mediaUrl);
      if (!mediaPromise) {
        mediaPromise = validateRemoteMediaUrl(mediaUrl, { allowMediaProbe: false });
        mediaCache.set(mediaUrl, mediaPromise);
      }
      try {
        preview.media = await mediaPromise;
        if (preview.media.type !== type.mediaType) {
          preview.errors.push(`${type.name} requires ${type.mediaType} media, but the URL reports ${preview.media.type}.`);
        }
      } catch (error) {
        preview.errors.push(error instanceof Error ? error.message : "Remote media metadata could not be verified.");
      }
    }

    const validation = validateDestination(destination, preview.media, now);
    addUnique(preview.errors, validation.errors);
    if (validation.scheduledAt && validation.errors.length === 0) {
      preview.action = destinationAction(destination, validation.scheduledAt);
    }
  }

  const candidates = rows
    .filter((row): row is BulkJsonPreviewRow & { destination: DestinationDraft } => Boolean(row.destination))
    .map((row) => ({ destination: row.destination, mediaUrl: row.mediaUrl || null, mediaUrls: row.mediaUrls }));
  const conflicts = findDuplicateConflictsForCandidates(candidates, existingPosts);
  conflicts.forEach((conflict) => {
    const row = rows.find((item) => item.destination?.key === conflict.destinationKey);
    if (row && !row.errors.includes(conflict.message)) row.errors.push(conflict.message);
  });

  const valid = rootErrors.length === 0 && rows.length > 0 && rows.every((row) => row.errors.length === 0);
  return { rootErrors, rows, valid };
}
