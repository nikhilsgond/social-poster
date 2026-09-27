// src/components/Post/PostModal.tsx
import React, { useState, useEffect, useRef, useCallback } from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import { FIELD_SCHEMA, METRIC_FIELDS } from "../../lib/contentTypes";
import { uploadMediaFile, validateMediaFile, isImageFile, isVideoFile } from "../../lib/cloudinary";
import type { Post, Platform } from "../../types/post";

interface PostModalProps {
  post: Post | null;
  onSave: (postData: any) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  initialDate?: string;
  initialPlatform?: Platform;
}

type UploadState = "idle" | "uploading" | "success" | "error";

export const PostModal: React.FC<PostModalProps> = ({
  post,
  onSave,
  onDelete,
  onClose,
  initialDate,
  initialPlatform,
}) => {
  const { showToast } = useToast();
  const isEdit = post !== null;
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [platform, setPlatform] = useState<Platform>(
    isEdit ? post!.platform : initialPlatform ?? "yt"
  );
  const [title, setTitle] = useState(isEdit ? post!.title ?? "" : "");
  const [topic, setTopic] = useState(isEdit ? post!.topic ?? "" : "");
  const [content, setContent] = useState(isEdit ? post!.content ?? "" : "");
  const [description, setDescription] = useState(isEdit ? post!.description ?? "" : "");
  const [caption, setCaption] = useState(isEdit ? post!.caption ?? "" : "");
  const [contentType, setContentType] = useState(isEdit ? post!.contentType ?? "" : "");
  const [date, setDate] = useState(isEdit ? post!.date : initialDate ?? "");
  const [time, setTime] = useState(isEdit ? post!.time : "");
  const [views, setViews] = useState(isEdit ? (post!.views ?? "") : "");
  const [likes, setLikes] = useState(isEdit ? (post!.likes ?? "") : "");
  const [comments, setComments] = useState(isEdit ? (post!.comments ?? "") : "");

  // Media upload state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(isEdit ? (post!.mediaUrl || null) : null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Auto-focus first text/textarea/select input on open
  useEffect(() => {
    const timer = setTimeout(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Overlay click handler
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === overlayRef.current) onClose();
    },
    [onClose]
  );

  // Get fields for the selected platform
  const fields = FIELD_SCHEMA[platform];
  const fieldMap = new Map(fields.map((f) => [f.key, f]));

  // ── Media Upload ──
  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const validation = validateMediaFile(file);
    if (!validation.valid) {
      setUploadError(validation.error || "Invalid file.");
      setUploadState("error");
      return;
    }
    setMediaFile(file);
    setUploadState("uploading");
    setUploadError(null);

    // Create preview
    const url = URL.createObjectURL(file);
    setMediaPreview(url);

    // Upload to Cloudinary
    uploadMediaFile(file, { folder: "social_planner" })
      .then((result) => {
        setUploadState("success");
        setUploadProgress(100);
        // Store the result for form submission
        setMediaFile(file);
        // Attach Cloudinary result to a data attribute for the parent
        (file as any).cloudinaryResult = result;
      })
      .catch((err: any) => {
        setUploadState("error");
        setUploadError(err.message || "Upload failed.");
        setMediaPreview(null);
        URL.revokeObjectURL(url);
        showToast("Upload failed", err.message || "Cloudinary upload failed.", "error");
      });
  }, []);

  const handleRemoveMedia = useCallback(() => {
    setMediaFile(null);
    setMediaPreview(null);
    setUploadState("idle");
    setUploadError(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Form Submit ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const metrics: Record<string, number | undefined> = {};
    if (views !== "" && !isNaN(Number(views))) metrics.views = Number(views);
    if (likes !== "" && !isNaN(Number(likes))) metrics.likes = Number(likes);
    if (comments !== "" && !isNaN(Number(comments))) metrics.comments = Number(comments);

    const baseData: any = {
      platform,
      contentType: contentType || (fieldMap.get("contentType")?.options?.[0] ?? ""),
      title: title || undefined,
      topic: topic || undefined,
      content: content || undefined,
      description: description || undefined,
      caption: caption || undefined,
      date,
      time,
      ...metrics,
    };

    // Attach Cloudinary media data if uploaded
    if (mediaFile && (mediaFile as any).cloudinaryResult) {
      const result = (mediaFile as any).cloudinaryResult;
      baseData.mediaUrl = result.secure_url;
      baseData.cloudinaryPublicId = result.public_id;
    }

    if (isEdit && post) {
      baseData.id = post.id;
      baseData.status = post.status;
      baseData.platformPostId = post.platformPostId;
      baseData.metricsUpdatedAt = post.metricsUpdatedAt;
      baseData.createdAt = post.createdAt;
      baseData.updatedAt = post.updatedAt;
      showToast("Success", `${platformDataMap[platform].name} post updated`, "success");
    } else {
      showToast("Success", `${platformDataMap[platform].name} post added`, "success");
    }

    onSave(baseData);
  };

  const handleDelete = () => {
    if (isEdit && post) {
      showToast("Deleted", `${platformDataMap[platform].name} post removed`, "warning");
      onDelete(post.id);
    }
  };

  // Format "X ago" for metrics updated at
  const formatMetricsAgo = () => {
    if (!isEdit || !post?.metricsUpdatedAt) return null;
    const then = new Date(post.metricsUpdatedAt).getTime();
    const now = Date.now();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
  };

  const metricsAgo = formatMetricsAgo();

  return (
    <div className="overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="panel" role="dialog" aria-modal="true">
        <form onSubmit={handleSubmit}>
          {/* Title */}
          <h3>{isEdit ? "Edit Post" : "Add Post"}</h3>
          <p className="sub">
            {isEdit ? `Editing post on ${platformDataMap[platform].name}` : "Create a new scheduled post"}
          </p>

          {/* Platform Selector */}
          <label>Platform</label>
          {isEdit ? (
            <div className="platform-fixed">
              <PlatformIcon platform={platform} /> {platformDataMap[platform].name}
            </div>
          ) : (
            <div className="platform-picker">
              {(Object.keys(platformDataMap) as Platform[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`platform-pick-btn ${platform === p ? "active" : ""}`}
                  onClick={() => {
                    setPlatform(p);
                    const schema = FIELD_SCHEMA[p];
                    setContentType(schema[0]?.options?.[0] ?? "");
                    setTitle("");
                    setTopic("");
                    setContent("");
                    setDescription("");
                    setCaption("");
                  }}
                >
                  <PlatformIcon platform={p} />
                </button>
              ))}
            </div>
          )}

          {/* Platform-Specific Fields */}
          {fields.map((field) => {
            const isFirstTextInput =
              (field.type === "text" || field.type === "textarea") &&
              !firstInputRef.current;

            return (
              <div key={field.key}>
                <label htmlFor={field.key}>{field.label}</label>
                {field.type === "select" ? (
                  <select
                    id={field.key}
                    value={field.key === "contentType" ? contentType : field.options?.[0] ?? ""}
                    onChange={(e) => {
                      if (field.key === "contentType") setContentType(e.target.value);
                    }}
                    ref={isFirstTextInput ? (firstInputRef as React.RefObject<HTMLSelectElement>) : undefined}
                  >
                    {field.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : field.type === "textarea" ? (
                  <textarea
                    id={field.key}
                    value={
                      field.key === "description"
                        ? description
                        : field.key === "caption"
                        ? caption
                        : content
                    }
                    onChange={(e) => {
                      if (field.key === "description") setDescription(e.target.value);
                      else if (field.key === "caption") setCaption(e.target.value);
                      else setContent(e.target.value);
                    }}
                    rows={3}
                    ref={isFirstTextInput ? (firstInputRef as React.RefObject<HTMLTextAreaElement>) : undefined}
                  />
                ) : (
                  <input
                    id={field.key}
                    type="text"
                    value={
                      field.key === "title"
                        ? title
                        : field.key === "topic"
                        ? topic
                        : ""
                    }
                    onChange={(e) => {
                      if (field.key === "title") setTitle(e.target.value);
                      else if (field.key === "topic") setTopic(e.target.value);
                    }}
                    ref={isFirstTextInput ? (firstInputRef as React.RefObject<HTMLInputElement>) : undefined}
                  />
                )}
              </div>
            );
          })}

          {/* Date and Time */}
          <label htmlFor="post-date">Date</label>
          <input
            id="post-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <label htmlFor="post-time">Time</label>
          <input
            id="post-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />

          {/* Media Upload Section */}
          <label>Media</label>
          <div className="media-upload">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              onChange={handleFileSelect}
              style={{ display: "none" }}
            />
            {uploadState === "idle" || uploadState === "error" ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadState === "error" ? `Error: ${uploadError} — Retry` : "Select Image/Video"}
              </button>
            ) : uploadState === "uploading" ? (
              <div className="upload-progress">
                <span>Uploading...</span>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${uploadProgress}%` }} /></div>
              </div>
            ) : uploadState === "success" ? (
              <div className="upload-success">
                {mediaPreview && (isImageFile(mediaFile!) || uploadState === "success") && (
                  <div className="media-preview">
                    {isImageFile(mediaFile!) ? (
                      <img src={mediaPreview} alt="Preview" />
                    ) : (
                      <video src={mediaPreview} />
                    )}
                  </div>
                )}
                <button type="button" className="btn-mini btn-danger" onClick={handleRemoveMedia}>
                  Remove
                </button>
              </div>
            ) : null}
            {uploadError && (
              <div className="upload-error">{uploadError}</div>
            )}
          </div>

          {/* Metrics Section */}
          <label>Metrics</label>
          <div className="metrics-grid">
            {METRIC_FIELDS.map((mf) => (
              <div key={mf.key}>
                <span style={{ fontSize: "0.78rem", color: "var(--muted)", display: "block", marginBottom: "5px", fontWeight: 600 }}>
                  {mf.label}
                </span>
                <input
                  type="number"
                  placeholder="—"
                  value={mf.key === "views" ? views : mf.key === "likes" ? likes : comments}
                  onChange={(e) => {
                    if (mf.key === "views") setViews(e.target.value);
                    else if (mf.key === "likes") setLikes(e.target.value);
                    else setComments(e.target.value);
                  }}
                  style={{ width: "100%" }}
                />
              </div>
            ))}
          </div>

          {/* Metrics last updated note when editing */}
          {isEdit && metricsAgo && (
            <p className="metrics-updated-note">
              Metrics last updated {metricsAgo}
            </p>
          )}

          {/* Actions */}
          <div className="panel-actions">
            {isEdit && (
              <button type="button" className="btn-danger" onClick={handleDelete}>
                Delete
              </button>
            )}
            <div className="right">
              <button type="button" className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn-import">
                {isEdit ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
