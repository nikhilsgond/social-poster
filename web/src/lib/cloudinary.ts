// src/lib/cloudinary.ts
// Cloudinary configuration and upload service.
// Uses unsigned upload preset for browser-safe uploads.
// Never exposes API Secret to the browser.
// Only VITE_ variables are used in the frontend.

export interface CloudinaryUploadResult {
  secure_url: string;
  public_id: string;
  resource_type: string;
  format: string;
  bytes: number;
}

export interface CloudinaryConfig {
  cloudName: string;
  uploadPreset: string;
}

export function getCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  if (!cloudName || !uploadPreset) return null;
  return { cloudName, uploadPreset };
}

export function hasCloudinaryConfig(): boolean {
  return getCloudinaryConfig() !== null;
}

export async function uploadToCloudinary(
  file: File,
  options?: { folder?: string }
): Promise<CloudinaryUploadResult> {
  const config = getCloudinaryConfig();
  if (!config) {
    throw new Error(
      "Cloudinary not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env.local"
    );
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", config.uploadPreset);
  if (options?.folder) formData.append("folder", options.folder);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`,
    { method: "POST", body: formData }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    secure_url: data.secure_url,
    public_id: data.public_id,
    resource_type: data.resource_type || "image",
    format: data.format || "",
    bytes: data.bytes || file.size,
  };
}

export async function uploadVideoToCloudinary(
  file: File,
  options?: { folder?: string }
): Promise<CloudinaryUploadResult> {
  const config = getCloudinaryConfig();
  if (!config) {
    throw new Error(
      "Cloudinary not configured. Set VITE_CLOUDINARY_CLOUD_NAME and VITE_CLOUDINARY_UPLOAD_PRESET in .env.local"
    );
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", config.uploadPreset);
  formData.append("resource_type", "video");
  if (options?.folder) formData.append("folder", options.folder);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloudName}/video/upload`,
    { method: "POST", body: formData }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cloudinary upload failed (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    secure_url: data.secure_url,
    public_id: data.public_id,
    resource_type: "video",
    format: data.format || "",
    bytes: data.bytes || file.size,
  };
}

// ── Validation ──

export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MiB

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"
];

export const SUPPORTED_VIDEO_TYPES = [
  "video/mp4", "video/webm", "video/mov", "video/avi"
];

export function getSupportedTypes(): string[] {
  return [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES];
}

export function validateMediaFile(file: File): { valid: boolean; error?: string } {
  if (!file) return { valid: false, error: "No file provided." };
  if (file.size > MAX_FILE_SIZE) {
    return { valid: false, error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MiB limit.` };
  }
  const allTypes = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES];
  if (!allTypes.includes(file.type)) {
    return { valid: false, error: `Unsupported file type: ${file.type || "unknown"}.` };
  }
  return { valid: true };
}

export function isImageFile(file: File): boolean {
  return SUPPORTED_IMAGE_TYPES.includes(file.type);
}

export function isVideoFile(file: File): boolean {
  return SUPPORTED_VIDEO_TYPES.includes(file.type);
}

export async function uploadMediaFile(
  file: File,
  options?: { folder?: string }
): Promise<CloudinaryUploadResult> {
  if (isVideoFile(file)) {
    return uploadVideoToCloudinary(file, options);
  }
  return uploadToCloudinary(file, options);
}
