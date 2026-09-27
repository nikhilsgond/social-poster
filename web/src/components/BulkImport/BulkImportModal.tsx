// src/components/BulkImport/BulkImportModal.tsx
import React, { useState, useRef, useCallback, useEffect } from "react";
import type { Platform, Post } from "../../types/post";
import { FIELD_SCHEMA } from "../../lib/contentTypes";
import { PlatformIcon } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import { usePostContext } from "../../context/PostContext";
import { validatePost } from "../../lib/validation";

interface BulkState {
  platform: Platform;
  fileName: string;
  data: { items: Record<string, unknown>[]; errors: string[]; warnings: string[] } | null;
  errors: string[];
  warnings: string[];
  progress: number;
  phase: string;
}

interface BulkImportModalProps {
  onClose: () => void;
  onImportComplete: () => void;
}

function isValidDateString(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const p = value.split("-").map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

const validateBulkJson = (raw: string, platformKey: Platform, existingPosts: Post[]) => {
  const result: { items: Record<string, unknown>[]; errors: string[]; warnings: string[] } = {
    items: [],
    errors: [],
    warnings: [],
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    result.errors.push("Invalid JSON: " + (e instanceof Error ? e.message : "Could not parse the file."));
    return result;
  }
  if (!Array.isArray(parsed)) {
    result.errors.push("The JSON root must be an array of posts.");
    return result;
  }
  if (parsed.length === 0) {
    result.errors.push("The JSON file contains no posts.");
    return result;
  }

  const schema = FIELD_SCHEMA[platformKey] || FIELD_SCHEMA.x;
  const seen: Record<string, number> = {};

  (parsed as Record<string, unknown>[]).forEach(function (item, idx) {
    const n = idx + 1;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      result.errors.push("Row " + n + ": each item must be an object.");
      return;
    }
    if (!item.date) result.errors.push("Row " + n + ": date is required.");
    else if (!isValidDateString(item.date)) result.errors.push("Row " + n + ": date must be a real date in YYYY-MM-DD format.");
    if (!((item as any).platform as string)) result.errors.push("Row " + n + ": platform is required.");
    else if ((item as any).platform as string !== platformKey) result.errors.push("Row " + n + ": platform must match the selected platform (" + platformKey + ").");
    if (item.time !== undefined && item.time !== "") {
      if (typeof item.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time as string))
        result.errors.push("Row " + n + ": time must use HH:MM (24-hour) format.");
    }
    schema.forEach(function (f) {
      if (f.key === "contentType" && ((item as any)[f.key] === undefined || String((item as any)[f.key]).trim() === "")) {
        result.errors.push("Row " + n + ": contentType is required.");
      }
      if (f.type === "select" && (item as any)[f.key] !== undefined && f.options!.indexOf((item as any)[f.key] as string) === -1) {
        result.errors.push("Row " + n + ": " + f.key + " must be one of " + f.options!.join(", ") + ".");
      }
      if ((item as any)[f.key] !== undefined && typeof (item as any)[f.key] !== "string") result.errors.push("Row " + n + ": " + f.key + " must be text.");
    });
    const hasContent = schema.some(function (f) { return (item as any)[f.key] !== undefined && String((item as any)[f.key]).trim() !== ""; });
    if (!hasContent) result.errors.push("Row " + n + ": at least one platform content field is required.");
    if ((item as any).metrics !== undefined) {
      if (!(item as any).metrics || typeof (item as any).metrics !== "object" || Array.isArray((item as any).metrics))
        result.errors.push("Row " + n + ": metrics must be an object.");
      else
        ["views", "likes", "comments"].forEach(function (m) {
          if ((item as any).metrics[m as string] !== undefined && (item as any).metrics[m as string] !== null && ((item as any).metrics[m as string] === "" || !Number.isFinite(Number((item as any).metrics[m as string])) || Number((item as any).metrics[m as string]) < 0))
            result.errors.push("Row " + n + ": " + m + " must be a non-negative number.");
        });
    }
    const sourceId = String((item as any).sourceId || (item as any).id || "").trim();
    const permalink = String((item as any).permalink || (item as any).permalink_url || "").trim();
    const duplicateKey = sourceId ? "sourceId|" + sourceId : permalink ? "permalink|" + permalink : "content|" + String(item.date || "") + "|" + platformKey + "|" + schema.map(function (f) { return String((item as any)[f.key] || "").trim(); }).join("|");
    if (seen[duplicateKey]) result.errors.push("Row " + n + ": duplicate of row " + seen[duplicateKey] + ".");
    else seen[duplicateKey] = n;
  });

  // Existing-record duplicates are warnings, not hard errors
  result.items = (parsed as Record<string, unknown>[]).map(function (item, idx) {
    const schema = FIELD_SCHEMA[platformKey] || FIELD_SCHEMA.x;
    const payload: Record<string, unknown> = {
      platform: platformKey,
      date: item.date,
      time: item.time || "",
    };
    schema.forEach(function (f) { payload[f.key] = (item as any)[f.key] === undefined ? "" : String((item as any)[f.key]); });
    const sourceId = String((item as any).sourceId || "").trim();
    const permalink = String((item as any).permalink || "").trim();
    if (sourceId) payload.sourceId = sourceId;
    if (permalink) payload.permalink = permalink;
    payload.metrics = {};
    ["views", "likes", "comments"].forEach(function (m) {
      (payload.metrics as Record<string, any>)[m] = (item as any).metrics && (item as any).metrics[m as string] !== undefined && (item as any).metrics[m as string] !== null && (item as any).metrics[m as string] !== "" ? Number((item as any).metrics[m as string]) : null;
    });
    payload.metricsUpdatedAt = null;
    return payload;
  });

  result.items.forEach(function (item, idx) {
    const incomingSourceId = String((item as any).sourceId || "").trim();
    const incomingPermalink = String((item as any).permalink || "").trim();
    const exists = existingPosts.some(function (p) {
      if (incomingSourceId && String(p.sourceId || "").trim() === incomingSourceId) return true;
      if (incomingPermalink && String(p.permalink || "").trim() === incomingPermalink) return true;
      if (p.platform !== (item as any).platform as string || p.date !== item.date) return false;
      return schema.every(function (f) { return String((p as any)[f.key] || "").trim() === String((item as any)[f.key] || "").trim(); });
    });
    if (exists) result.warnings.push("Row " + (idx + 1) + ": an identical post already exists and will be skipped.");
  });

  if (result.errors.length) result.items = [];
  return result;
}

function bulkTemplate(platformKey: Platform): string {
  const schema = FIELD_SCHEMA[platformKey] || FIELD_SCHEMA.x;
  const example: Record<string, unknown> = {
    platform: platformKey,
    date: "2026-10-01",
    time: "10:00",
  };
  schema.forEach(function (f) {
    example[f.key] = f.type === "select" ? f.options![0] : "Example content";
  });
  example.metrics = { views: 0, likes: 0, comments: 0 };
  return JSON.stringify([example], null, 2);
}

export const BulkImportModal: React.FC<BulkImportModalProps> = ({ onClose, onImportComplete }) => {
  const { showToast } = useToast();
  const { posts, bulkAddPosts } = usePostContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<BulkState>({
    platform: "yt",
    fileName: "",
    data: null,
    errors: [],
    warnings: [],
    progress: 0,
    phase: "",
  });

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handlePlatformPick = useCallback((key: Platform) => {
    setState((prev) => ({ ...prev, platform: key, fileName: "", data: null, errors: [], warnings: [], progress: 0, phase: "" }));
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readBulkFile(file);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readBulkFile(file);
  }, []);

  const readBulkFile = useCallback((file: File) => {
    setState((prev) => ({ ...prev, fileName: file.name, data: null, progress: 0, phase: "Reading file…" }));
    showToast("Reading JSON", "Opening " + file.name + "…", "info", 2200);

    const reader = new FileReader();
    reader.onprogress = function (e) {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 80);
        setState((prev) => ({ ...prev, progress: pct, phase: "Reading file…" }));
      }
    };
    reader.onload = function (e) {
      setState((prev) => ({ ...prev, progress: 85, phase: "Validating JSON…" }));
      setTimeout(function () {
        try {
          const result = validateBulkJson(String(e.target?.result || ""), state.platform, posts);
          setState((prev) => ({
            ...prev,
            data: result,
            progress: 100,
            phase: result.errors.length ? "Validation failed" : "Validation complete",
          }));
          if (result.errors.length) {
            showToast("Validation failed", result.errors.length + " error" + (result.errors.length === 1 ? "" : "s") + " found. Nothing was imported.", "error", 6000);
          } else {
            showToast("JSON validated", result.items.length + " post" + (result.items.length === 1 ? "" : "s") + " ready to import.", "success", 3200);
          }
        } catch (err) {
          setState((prev) => ({
            ...prev,
            data: { items: [], errors: ["Unexpected validation error: " + (err instanceof Error ? err.message : String(err))], warnings: [] },
            progress: 100,
            phase: "Validation failed",
          }));
          showToast("Import error", "The JSON could not be validated. Nothing was imported.", "error", 6000);
        }
      }, 30);
    };
    reader.onerror = function () {
      setState((prev) => ({
        ...prev,
        data: { items: [], errors: ["Could not read the selected file. Check that the file is accessible and is a valid JSON file."], warnings: [] },
        progress: 100,
        phase: "File read failed",
      }));
      showToast("File read failed", "The JSON file could not be read. Nothing was imported.", "error", 6000);
    };
    reader.onabort = function () {
      setState((prev) => ({ ...prev, data: { items: [], errors: ["File reading was cancelled."], warnings: [] }, progress: 0, phase: "Cancelled" }));
      showToast("Import cancelled", "No posts were imported.", "warning", 3000);
    };
    reader.readAsText(file);
  }, [state.platform, showToast, posts]);

  const handleConfirm = useCallback(() => {
    if (!state.data || state.data.errors.length || !state.data.items.length) return;
    let added = 0;
    let skipped = 0;

    state.data.items.forEach(function (item) {
      const incomingSourceId = String((item as any).sourceId || "").trim();
      const incomingPermalink = String((item as any).permalink || "").trim();
      const exists = posts.some(function (p) {
        if (incomingSourceId && String(p.sourceId || "").trim() === incomingSourceId) return true;
        if (incomingPermalink && String(p.permalink || "").trim() === incomingPermalink) return true;
        if (p.platform !== (item as any).platform as string || p.date !== item.date) return false;
        const schema = FIELD_SCHEMA[(item as any).platform as string as Platform] || FIELD_SCHEMA.x;
        return schema.every(function (f) { return String((p as any)[f.key] || "").trim() === String((item as any)[f.key] || "").trim(); });
      });
      if (exists) { skipped++; return; }
      const platformKey = (item as any).platform as string as Platform;
      const schema = FIELD_SCHEMA[platformKey] || FIELD_SCHEMA.x;
      const post: Record<string, unknown> = { platform: platformKey, date: item.date, time: item.time || "" };
      schema.forEach(function (f) { post[f.key] = (item as any)[f.key] || ""; });
      if (incomingSourceId) post.sourceId = incomingSourceId;
      if (incomingPermalink) post.permalink = incomingPermalink;
      post.metrics = {};
      ["views", "likes", "comments"].forEach(function (m) { (post.metrics as Record<string, any>)[m] = (item as any).metrics && (item as any).metrics[m as string] !== undefined && (item as any).metrics[m as string] !== null && (item as any).metrics[m as string] !== "" ? Number((item as any).metrics[m as string]) : null; });
      post.metricsUpdatedAt = null;
    });

    // All valid items go through bulkAddPosts
    const validItems: Post[] = state.data.items.map(function (item) {
      const platformKey = (item as any).platform as string as Platform;
      const schema = FIELD_SCHEMA[platformKey] || FIELD_SCHEMA.x;
      const post: Record<string, unknown> = { platform: platformKey, date: item.date, time: item.time || "" };
      schema.forEach(function (f) { post[f.key] = (item as any)[f.key] || ""; });
      const sourceId = String((item as any).sourceId || "").trim();
      const permalink = String((item as any).permalink || "").trim();
      if (sourceId) post.sourceId = sourceId;
      if (permalink) post.permalink = permalink;
      post.metrics = {};
      ["views", "likes", "comments"].forEach(function (m) { (post.metrics as Record<string, any>)[m] = (item as any).metrics && (item as any).metrics[m as string] !== undefined && (item as any).metrics[m as string] !== null && (item as any).metrics[m as string] !== "" ? Number((item as any).metrics[m as string]) : null; });
      post.metricsUpdatedAt = null;
      return post as Post;
    }).filter(function (item) {
      const incomingSourceId = String((item as any).sourceId || "").trim();
      const incomingPermalink = String((item as any).permalink || "").trim();
      return !posts.some(function (p) {
        if (incomingSourceId && String(p.sourceId || "").trim() === incomingSourceId) return true;
        if (incomingPermalink && String(p.permalink || "").trim() === incomingPermalink) return true;
        if (p.platform !== (item as any).platform as string || p.date !== item.date) return false;
        const schema = FIELD_SCHEMA[(item as any).platform as string as Platform] || FIELD_SCHEMA.x;
        return schema.every(function (f) { return String((p as any)[f.key] || "").trim() === String((item as any)[f.key] || "").trim(); });
      });
    });

    if (validItems.length) {
      bulkAddPosts(validItems);
    }

    const imported = validItems.length;
    const dupSkipped = state.data.items.length - validItems.length;
    onImportComplete();
    showToast("Import complete", imported + " post" + (imported === 1 ? "" : "s") + " added" + (dupSkipped ? " · " + dupSkipped + " duplicate(s) skipped" : "") + ".", "success", 4200);
  }, [state.data, onImportComplete, showToast, posts, bulkAddPosts]);

  const disabled = !(state.data && !state.data.errors.length && state.data.items.length);
  const plat = state.platform;
  const platformButtons = (["yt", "ig", "fb", "th", "li", "x"] as Platform[]).map(function (p) {
    return (
      <button
        key={p}
        type="button"
        className={"platform-pick-btn" + (state.platform === p ? " active" : "")}
        onClick={() => handlePlatformPick(p)}
      >
        <PlatformIcon platform={p} iconOnly /> {p.toUpperCase()}
      </button>
    );
  });

  let statusContent: React.ReactNode = null;
  if (state.fileName && !state.data) {
    const pct = Math.max(0, Math.min(100, state.progress));
    statusContent = (
      <div className="bulk-progress">
        <div className="bulk-progress-head">
          <span>{state.phase || "Reading file…"}</span>
          <span id="bulkProgressPct">{pct}%</span>
        </div>
        <div className="bulk-progress-track">
          <div className="bulk-progress-bar" style={{ width: pct + "%" }} />
        </div>
        <div className="bulk-progress-meta">The file is read locally. Nothing is saved until validation succeeds.</div>
      </div>
    );
  }
  if (state.data) {
    if (state.data.errors.length) {
      statusContent = <div className="bulk-errors">{state.data.errors.map(function (x, i) { return <div key={i} className="error">{x}</div>; })}</div>;
    } else {
      statusContent = <div className="bulk-ok"><strong>{state.data.items.length} posts ready to import.</strong> No validation errors found.</div>;
      if (state.data.warnings.length) statusContent = <><div className="bulk-ok"><strong>{state.data.items.length} posts ready to import.</strong> No validation errors found.</div><div className="bulk-errors" style={{ marginTop: 8 }}>{state.data.warnings.map(function (x, i) { return <div key={i} className="error">{x}</div>; })}</div></>;
    }
    statusContent = (
      <>
        <div className="bulk-summary">
          <span className="bulk-stat"><strong>{state.data.items.length}</strong> valid</span>
          <span className="bulk-stat"><strong>{state.data.errors.length}</strong> errors</span>
          <span className="bulk-stat"><strong>{state.data.warnings.length}</strong> warnings</span>
        </div>
        {statusContent}
      </>
    );
  }

  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="panel" role="dialog" aria-modal="true">
        <h3>Bulk Import JSON</h3>
        <div className="sub">Import multiple {plat.toUpperCase()} posts at once. Nothing is saved until validation passes.</div>

        <label>Platform</label>
        <div className="platform-picker">{platformButtons}</div>

        <label>JSON file</label>
        <label className="file-drop" onDrop={handleFileDrop} onDragOver={(e) => e.preventDefault()}>
          <input ref={fileInputRef} id="bulkFileInput" type="file" accept="application/json,.json" onChange={handleFileChange} style={{ display: "none" }} />
          <strong>Choose JSON file</strong>
          <span>{state.fileName || "Expected: an array of post objects"}</span>
        </label>

        {statusContent}

        <label>Expected format</label>
        <div className="json-code">{bulkTemplate(state.platform)}</div>

        <div className="panel-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <div className="right">
            <button type="button" className="btn-primary" disabled={disabled} onClick={handleConfirm} style={disabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
              Import {state.data && !state.data.errors.length ? state.data.items.length : 0} Posts
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
