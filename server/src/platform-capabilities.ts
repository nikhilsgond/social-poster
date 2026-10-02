export type PublishingPlatform = "ig" | "th" | "fb" | "yt";
export type RequiredMediaType = "none" | "image" | "video";
export type FieldSupport = "required" | "optional" | "unsupported" | "required-for-scheduling";

export interface ContentTypeCapability {
  name: string;
  backendType: string;
  mediaType: RequiredMediaType;
  mediaRequired: boolean;
  multipleImages?: boolean;
}

export interface PlatformCapability {
  name: string;
  contentTypes: readonly ContentTypeCapability[];
  fields: {
    title: FieldSupport;
    caption: FieldSupport;
    content: FieldSupport;
    description: FieldSupport;
    tags: FieldSupport;
    mediaUrl: FieldSupport;
    date: FieldSupport;
    time: FieldSupport;
  };
  nativeFutureScheduling: boolean;
  immediatePublishing: boolean;
  storySupport: boolean;
  limits: Readonly<Record<string, number>>;
  legacyContentTypeAliases: Readonly<Record<string, string>>;
  restrictions: readonly string[];
}

export const PLATFORM_CAPABILITIES: Readonly<Record<PublishingPlatform, PlatformCapability>> = {
  ig: {
    name: "Instagram",
    contentTypes: [
      { name: "Image", backendType: "IMAGE", mediaType: "image", mediaRequired: true },
      { name: "Video", backendType: "VIDEO", mediaType: "video", mediaRequired: true },
      { name: "Reel", backendType: "REELS", mediaType: "video", mediaRequired: true },
      { name: "Story Image", backendType: "STORIES", mediaType: "image", mediaRequired: true },
      { name: "Story Video", backendType: "STORIES", mediaType: "video", mediaRequired: true },
    ],
    fields: {
      title: "unsupported", caption: "optional", content: "optional", description: "unsupported",
      tags: "unsupported", mediaUrl: "required", date: "required-for-scheduling", time: "required-for-scheduling",
    },
    nativeFutureScheduling: false,
    immediatePublishing: true,
    storySupport: true,
    limits: { storyVideoMaxBytes: 8 * 1024 * 1024 },
    legacyContentTypeAliases: {
      Reels: "Reel",
      StoryImage: "Story Image",
      STORY_IMAGE: "Story Image",
      StoryVideo: "Story Video",
      STORY_VIDEO: "Story Video",
    },
    restrictions: [
      "Media URLs must be publicly accessible to Meta.",
      "Future posts are held by Social Planner and published when due; Instagram native scheduling is not used.",
      "Story Video is limited to 8 MB when Content-Length can be determined.",
      "Carousel container support is not end-to-end because persisted child container IDs are not loaded into publisher posts.",
    ],
  },
  th: {
    name: "Threads",
    contentTypes: [
      { name: "Text", backendType: "TEXT", mediaType: "none", mediaRequired: false },
      { name: "Image", backendType: "IMAGE", mediaType: "image", mediaRequired: true },
      { name: "Video", backendType: "VIDEO", mediaType: "video", mediaRequired: true },
    ],
    fields: {
      title: "unsupported", caption: "optional", content: "optional", description: "unsupported",
      tags: "unsupported", mediaUrl: "optional", date: "required-for-scheduling", time: "required-for-scheduling",
    },
    nativeFutureScheduling: false,
    immediatePublishing: true,
    storySupport: false,
    limits: {},
    legacyContentTypeAliases: {},
    restrictions: [
      "Text posts require content and cannot include media.",
      "Image and Video posts require a publicly accessible media URL; caption/content is optional.",
      "Future posts are held by Social Planner and published when due; Threads native scheduling is not used.",
    ],
  },
  fb: {
    name: "Facebook",
    contentTypes: [
      { name: "Text", backendType: "TEXT", mediaType: "none", mediaRequired: false },
      { name: "Image", backendType: "IMAGE", mediaType: "image", mediaRequired: true },
      { name: "Multiple Images", backendType: "MULTIPLE_IMAGES", mediaType: "image", mediaRequired: true, multipleImages: true },
      { name: "Reel", backendType: "REELS", mediaType: "video", mediaRequired: true },
    ],
    fields: {
      title: "unsupported", caption: "optional", content: "optional", description: "unsupported",
      tags: "unsupported", mediaUrl: "optional", date: "required-for-scheduling", time: "required-for-scheduling",
    },
    nativeFutureScheduling: true,
    immediatePublishing: true,
    storySupport: false,
    limits: {},
    legacyContentTypeAliases: {},
    restrictions: [
      "Text posts require content and cannot include media.",
      "Image posts require a publicly accessible image URL; caption/content is optional.",
      "Multiple Images requires at least two public image URLs, in display order.",
      "Reel requires one public video URL; Meta processing and encoding requirements apply.",
      "Text, Image, Multiple Images and Reel use native Facebook future scheduling.",
      "Video, Story, and Link publishing are not implemented by the current Facebook client.",
    ],
  },
  yt: {
    name: "YouTube",
    contentTypes: [
      { name: "Video", backendType: "video", mediaType: "video", mediaRequired: true },
    ],
    fields: {
      title: "required", caption: "unsupported", content: "optional", description: "optional",
      tags: "unsupported", mediaUrl: "required", date: "required-for-scheduling", time: "required-for-scheduling",
    },
    nativeFutureScheduling: true,
    immediatePublishing: false,
    storySupport: false,
    limits: {},
    legacyContentTypeAliases: {},
    restrictions: [
      "The uploader always creates a private video and relies on publishAt for future publication.",
      "Tags are currently fixed internally by the uploader and cannot be supplied by planner posts.",
      "Shorts, live streams, and community posts are not implemented.",
      "The uploader downloads the complete media URL into memory before multipart upload.",
    ],
  },
};

const contentTypeToken = (value: string) => value.trim().toLowerCase().replace(/[\s_-]+/g, "");

export function isPublishingPlatform(value: string): value is PublishingPlatform {
  return Object.prototype.hasOwnProperty.call(PLATFORM_CAPABILITIES, value);
}

export function getContentTypeCapability(
  platform: PublishingPlatform,
  value: string | undefined,
): ContentTypeCapability | undefined {
  if (!value) return undefined;
  const capability = PLATFORM_CAPABILITIES[platform];
  const token = contentTypeToken(value);
  const direct = capability.contentTypes.find((item) => contentTypeToken(item.name) === token);
  if (direct) return direct;

  const alias = Object.entries(capability.legacyContentTypeAliases)
    .find(([legacy]) => contentTypeToken(legacy) === token)?.[1];
  return alias
    ? capability.contentTypes.find((item) => item.name === alias)
    : undefined;
}

export function supportedContentTypeNames(platform: PublishingPlatform): string[] {
  return PLATFORM_CAPABILITIES[platform].contentTypes.map((item) => item.name);
}

export interface CapabilityPostInput {
  platform?: string;
  contentType?: string;
  title?: string | null;
  caption?: string | null;
  content?: string | null;
  mediaUrl?: string | null;
  mediaUrls?: unknown;
}

export function validatePlatformPostCapability(input: CapabilityPostInput): {
  canonicalContentType?: string;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input.platform || !isPublishingPlatform(input.platform)) return { errors, warnings };

  const platform = input.platform;
  const type = getContentTypeCapability(platform, input.contentType);
  if (!type) {
    errors.push(
      `contentType must be one of ${supportedContentTypeNames(platform).join(", ")} for ${PLATFORM_CAPABILITIES[platform].name}.`,
    );
    return { errors, warnings };
  }

  if (input.contentType !== type.name) {
    warnings.push(`Legacy contentType "${input.contentType}" is normalized to "${type.name}".`);
  }
  if (platform === "fb" && type.multipleImages) {
    if (input.mediaUrl?.trim()) errors.push("Multiple Images uses mediaUrls, not mediaUrl.");
    if (!Array.isArray(input.mediaUrls)) errors.push("Multiple Images requires a mediaUrls array.");
    else {
      if (input.mediaUrls.length < 2) errors.push("Multiple Images requires at least 2 image URLs.");
      input.mediaUrls.forEach((value, index) => {
        try {
          if (typeof value !== "string" || !value.trim()) throw new Error();
          const url = new URL(value);
          if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
        } catch { errors.push(`mediaUrls[${index}] must be a valid HTTP/HTTPS URL.`); }
      });
    }
  } else if (platform === "fb" && input.mediaUrls != null) {
    errors.push(`${type.name} does not support mediaUrls; use mediaUrl for single media.`);
  }
  if (type.mediaRequired && !type.multipleImages && !input.mediaUrl?.trim()) {
    errors.push(`${type.name} requires a mediaUrl.`);
  }
  if (type.mediaType === "none" && input.mediaUrl?.trim()) {
    errors.push(`${type.name} does not support media with the current publisher.`);
  }
  if (platform === "th" && type.name === "Text" && !input.content?.trim() && !input.caption?.trim()) {
    errors.push("Threads Text requires content.");
  }
  if (platform === "fb" && type.name === "Text" && !input.content?.trim()) {
    errors.push("Facebook Text requires content.");
  }
  if (platform === "yt" && !input.title?.trim()) {
    errors.push("YouTube Video requires a title.");
  }

  return { canonicalContentType: type.name, errors, warnings };
}

export const NATIVE_SCHEDULING_PLATFORMS = (Object.keys(PLATFORM_CAPABILITIES) as PublishingPlatform[])
  .filter((platform) => PLATFORM_CAPABILITIES[platform].nativeFutureScheduling);

export const IMMEDIATE_PUBLISHING_PLATFORMS = (Object.keys(PLATFORM_CAPABILITIES) as PublishingPlatform[])
  .filter((platform) => PLATFORM_CAPABILITIES[platform].immediatePublishing);
