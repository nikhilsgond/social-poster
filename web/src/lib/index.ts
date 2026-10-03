// src/lib/index.ts
// Re-exports for the data layer, validation, metrics, and cloudinary.

export { generatePostId } from "./data";
export type {} from "./data";
export { validatePost, parseImportedPosts, normalizePost, generateId } from "./validation";
export type { ValidationResult, BulkValidationResult } from "./validation";
export {
  CONTENT_TYPES,
  FIELD_SCHEMA,
  METRIC_FIELDS,
  PUBLISHING_PLATFORM_CAPABILITIES,
  getContentTypeCapability,
  isPublishingPlatform,
  supportedContentTypeNames,
  validatePlatformPostCapability,
} from "./contentTypes";
export type {
  ContentTypeCapability,
  FieldSupport,
  PlatformCapability,
  PublishingPlatform,
  RequiredMediaType,
} from "./contentTypes";
export { formatMetric, escapeHtml, prettyDateShort, relativeTime, metricNumber, latestSnapshotsByPost, formatTimestamp } from "./metrics";
export {
  uploadToCloudinary,
  uploadVideoToCloudinary,
  uploadMediaFile,
  getCloudinaryConfig,
  hasCloudinaryConfig,
  validateMediaFile,
  isImageFile,
  isVideoFile,
  MAX_FILE_SIZE,
  SUPPORTED_IMAGE_TYPES,
  SUPPORTED_VIDEO_TYPES,
  getSupportedTypes,
} from "./cloudinary";
export type { CloudinaryUploadResult, CloudinaryConfig } from "./cloudinary";
