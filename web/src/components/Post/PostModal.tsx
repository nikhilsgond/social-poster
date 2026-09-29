// src/components/Post/PostModal.tsx
// Updated with Phase 3 Individual Post Analytics

import React, { useState, useEffect, useRef, useCallback } from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import { FIELD_SCHEMA, METRIC_FIELDS } from "../../lib/contentTypes";
import { uploadMediaFile, validateMediaFile, isImageFile, isVideoFile } from "../../lib/cloudinary";
import { fetchPostSnapshots } from "../../lib/supabasePosts";
import {
  formatMetric, escapeHtml, prettyDateShort, relativeTime,
  latestSnapshot, formatTimestamp,
  metricNumber
} from "../../lib/metrics";
import type { Post, Platform, MetricSnapshot } from "../../types/post";

interface PostModalProps {
  post: Post | null;
  onSave: (postData: any) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
  initialDate?: string;
  initialPlatform?: Platform;
  // Phase 3 — analytics
  snapshots?: MetricSnapshot[];
  snapshotLoading?: boolean;
  snapshotError?: string | null;
}

type UploadState = "idle" | "uploading" | "success" | "error";
type ActiveTab = "edit" | "analytics";

// ── Snapshot Table for Individual Post Analytics ──
function SnapshotTable({ snapshots }: { snapshots: MetricSnapshot[] }) {
  if (!snapshots.length) return <div className="empty-metrics">No snapshot data for this post.</div>;
  return (
    <table className="analysis-table">
      <thead>
        <tr><th>Captured</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th></tr>
      </thead>
      <tbody>
        {snapshots.map((s) => (
          <tr key={s.id || `${s.postId}-${s.capturedAt}`}>
            <td>{escapeHtml(formatTimestamp(s.capturedAt))}</td>
            <td className="num">{s.views}</td>
            <td className="num">{s.likes}</td>
            <td className="num">{s.comments}</td>
            <td className="num">{s.shares}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Platform Metrics Summary for Individual Posts ──
function PlatformMetricsSummary({ latest }: { latest: MetricSnapshot | null }) {
  if (!latest) return <div className="empty-metrics">No snapshot data available yet.</div>;
  const pm = latest.platformMetrics || {};
  const entries = Object.entries(pm);
  if (!entries.length) return <div className="empty-metrics">No platform-specific metrics stored.</div>;
  return (
    <table className="analysis-table">
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td>{escapeHtml(k)}</td>
            <td className="num">{typeof v === "number" ? v.toLocaleString() : escapeHtml(String(v))}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const PostModal: React.FC<PostModalProps> = ({
  post,
  onSave,
  onDelete,
  onClose,
  initialDate,
  initialPlatform,
  snapshots: externalSnapshots = [],
  snapshotLoading = false,
  snapshotError = null,
}) => {
  const { showToast } = useToast();
  const isEdit = post !== null;
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>(isEdit ? "edit" : "edit");
  const [platform, setPlatform] = useState<Platform>(
    isEdit ? post!.platform : initialPlatform ?? "yt"
  );

  // Form fields
  const [title, setTitle] = useState(isEdit ? post!.title ?? "" : "");
  const [topic, setTopic] = useState(isEdit ? post!.topic ?? "" : "");
  const [content, setContent] = useState(isEdit ? post!.content ?? "" : "");
  const [description, setDescription] = useState(isEdit ? post!.description ?? "" : "");
  const [caption, setCaption] = useState(isEdit ? post!.caption ?? "" : "");
  const [contentType, setContentType] = useState(isEdit ? post!.contentType ?? "" : "");
  const [date, setDate] = useState(isEdit ? post!.date : initialDate ?? "");
  const [time, setTime] = useState(isEdit ? post!.time : "");

  // Metrics fields
  const [views, setViews] = useState(isEdit ? (post!.views?.toString() ?? "") : "");
  const [likes, setLikes] = useState(isEdit ? (post!.likes?.toString() ?? "") : "");
  const [comments, setComments] = useState(isEdit ? (post!.comments?.toString() ?? "") : "");

  // Internal snapshots state for this post's analytics
  const [postSnapshots, setPostSnapshots] = useState<MetricSnapshot[]>([]);

  // Media upload state
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(isEdit ? (post!.mediaUrl || null) : null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Fetch snapshots when editing an existing post
  useEffect(() => {
    if (isEdit && post?.id) {
      fetchPostSnapshots(post.id)
        .then(setPostSnapshots)
        .catch(() => setPostSnapshots([]));
    }
  }, [isEdit, post?.id]);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Auto-focus first text/textarea/select input on open
  useEffect(() => {
    const timer = setTimeout(() => {
      if (firstInputRef.current) {
        firstInputRef.current.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, []);

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
        setMediaFile(file);
        (file as any).cloudinaryResult = result;
      })
      .catch((err: any) => {
        setUploadState("error");
        setUploadError(err.message || "Upload failed.");
        setMediaPreview(null);
        URL.revokeObjectURL(url);
        showToast("Upload failed", err.message || "Cloudinary upload failed.", "error");
      });
  }, [showToast]);

  const handleRemoveMedia = useCallback(() => {
    setMediaFile(null);
    setMediaPreview(null);
    setUploadState("idle");
    setUploadError(null);
    setUploadProgress(0);
    if (firstInputRef.current) {
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      if (input) input.value = "";
    }
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

  // ── Individual Post Analytics Section (Phase 3) ──
  const renderAnalytics = () => {
    if (!isEdit) return null;

    const latestSnap = latestSnapshot(postSnapshots);

    return (
      <div className="post-analytics">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3>Post Analytics</h3>
          <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
            Last updated: {post.metricsUpdatedAt ? relativeTime(post.metricsUpdatedAt) : "Never"}
          </span>
        </div>

        {/* Current Metrics Table */}
        <div className="chart-card" style={{ marginBottom: "12px" }}>
          <h4 style={{ marginBottom: "8px" }}>Current metrics</h4>
          <table className="analysis-table">
            <thead><tr><th>Metric</th><th>Value</th><th>Source</th></tr></thead>
            <tbody>
              <tr><td>Views</td><td className="num">{formatMetric(metricNumber(post, "views"))}</td><td>posts table</td></tr>
              <tr><td>Likes</td><td className="num">{formatMetric(metricNumber(post, "likes"))}</td><td>posts table</td></tr>
              <tr><td>Comments</td><td className="num">{formatMetric(metricNumber(post, "comments"))}</td><td>posts table</td></tr>
              <tr><td >Shares</td>
                <td className="num">
                  {latestSnap ? formatMetric(latestSnap.shares) : "—"}
                  {latestSnap && <span className="kpi-sub"> (latest snapshot)</span>}
                </td>
                <td>{latestSnap ? "snapshot" : "No snapshot data"}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Platform-specific metrics from latest snapshot */}
        {latestSnap?.platformMetrics && Object.keys(latestSnap.platformMetrics).length > 0 && (
          <div className="chart-card" style={{ marginBottom: "12px" }}>
            <h4>Platform-specific metrics</h4>
            <div className="chart-subtitle">From {platformDataMap[post.platform].name} API via snapshot</div>
            <PlatformMetricsSummary latest={latestSnap} />
          </div>
        )}

        {/* Historical snapshot table */}
        {postSnapshots.length > 0 ? (
          <div className="chart-card">
            <h4>Historical performance</h4>
            <div className="chart-subtitle">Metric changes over time from snapshots</div>
            <SnapshotTable snapshots={postSnapshots} />
          </div>
        ) : (
          snapshotLoading && (
            <div className="hint-bar">Loading snapshot data…</div>
          )
        )}
      </div>
    );
  };

  // Get fields for the selected platform
  const fieldsList = FIELD_SCHEMA[platform];

  return (
    <div className="overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="panel" role="dialog" aria-modal="true">
        {/* Analytics Tab Navigation */}
        {isEdit && (
          <div className="analytics-tabs" style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              type="button"
              onClick={() => setActiveTab("edit")}
              className={`analytics-tab ${activeTab === "edit" ? "active" : ""}`}
              style={{
                padding: "8px 16px",
                borderRadius: "6px 6px 0 0",
                background: activeTab === "edit" ? "var(--panel)" : "var(--card)",
                border: "1px solid var(--border)",
                borderBottom: activeTab === "edit" ? "none" : "1px solid var(--card)",
                cursor: "pointer",
                fontWeight: activeTab === "edit" ? 600 : 400,
              }}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("analytics")}
              className={`analytics-tab ${activeTab === "analytics" ? "active" : ""}`}
              style={{
                padding: "8px 16px",
                borderRadius: "6px 6px 0 0",
                background: activeTab === "analytics" ? "var(--panel)" : "var(--card)",
                border: "1px solid var(--border)",
                borderBottom: activeTab === "analytics" ? "none" : "1px solid var(--card)",
                cursor: "pointer",
                fontWeight: activeTab === "analytics" ? 600 : 400,
              }}
            >
              Analytics
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Title */}
          <h3>{isEdit ? (activeTab === "analytics" ? "Post Analytics" : "Edit Post") : "Add Post"}</h3>
          <p className="sub">
            {isEdit ? `Editing post on ${platformDataMap[platform].name}` : "Create a new scheduled post"}
          </p>

          {/* Platform Selector - only show on edit tab */}
          {activeTab === "edit" && (
            <>
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
            </>
          )}

          {/* Analytics View */}
          {isEdit && activeTab === "analytics" && renderAnalytics()}

          {/* Form fields - only show on edit tab for existing posts, or for new posts */}
          {activeTab === "edit" && (
            <>
              {/* Platform-Specific Fields */}
              {fieldsList.map((field) => {
                const isFirstTextInput =
                  (field.type === "text" || field.type === "textarea") && !firstInputRef.current;

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
            </>
          )}
        </form>
      </div>
    </div>
  );
};