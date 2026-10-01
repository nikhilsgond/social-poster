import React, { useEffect, useMemo, useRef, useState } from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { getStatusClass, getStatusLabel, type Platform, type Post } from "../../types/post";
import type { MetricsSyncPlatform } from "../../lib/backend";

const PLATFORMS: Platform[] = ["yt", "ig", "fb", "th", "li", "x"];

interface CalendarProps {
  year: number;
  month: number;
  posts: Post[];
  onAddPost: (defaults?: Partial<Post>) => void;
  onJumpToTable: (postId: string, platform: Platform) => void;
  onMovePost?: (postId: string, newDate: string) => void;
  onSync: (request: CalendarSyncRequest) => void;
  monthSync: CalendarMonthSyncState;
}

export type CalendarSyncStatus = "pending" | "running" | "succeeded" | "partial" | "failed" | "unavailable";
export type CalendarSyncPreset = "7d" | "30d" | "90d" | "custom" | "all";

export interface CalendarSyncRequest {
  preset: CalendarSyncPreset;
  startDate?: string;
  endDate?: string;
}

export interface CalendarPlatformSyncState {
  status: CalendarSyncStatus;
  discovered: number;
  added: number;
  existing: number;
  processed: number;
  failed: number;
  snapshotFailures: number;
  message?: string;
}

export interface CalendarMonthSyncState {
  running: boolean;
  monthLabel: string;
  results: Partial<Record<MetricsSyncPlatform, CalendarPlatformSyncState>>;
}

interface PreviewState {
  key: string;
  platform: Platform;
  posts: Post[];
  left: number;
  top: number;
  maxHeight: number;
  pinned: boolean;
}

const truncate = (value: string, max: number) =>
  value.length > max ? `${value.slice(0, max).trimEnd()}…` : value;

const postPreview = (post: Post) =>
  String(post.title || post.topic || post.content || post.caption || "Untitled post");

const timeLabel = (post: Post) => {
  if (post.status === "published" && post.publishedAt) {
    const published = new Date(post.publishedAt);
    if (!Number.isNaN(published.getTime())) {
      return published.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }
  return post.time || "No time set";
};

const canShowThumbnail = (post: Post) =>
  Boolean(post.mediaUrl) && !/(video|reel|short|live)/i.test(post.contentType || "");

export const Calendar: React.FC<CalendarProps> = ({
  year,
  month,
  posts,
  onAddPost,
  onJumpToTable,
  onMovePost,
  onSync,
  monthSync,
}) => {
  const hoverCloseTimer = useRef<number | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [syncPreset, setSyncPreset] = useState<CalendarSyncPreset>("30d");
  const [syncStartDate, setSyncStartDate] = useState("");
  const [syncEndDate, setSyncEndDate] = useState("");
  const customSyncDays = syncStartDate && syncEndDate
    ? Math.floor((Date.parse(syncEndDate) - Date.parse(syncStartDate)) / 86400000) + 1
    : 0;
  const customSyncError = syncPreset === "custom"
    ? !syncStartDate || !syncEndDate
      ? "Choose both dates."
      : syncStartDate > syncEndDate
        ? "From date cannot be after To date."
        : customSyncDays > 366
          ? "Custom sync is limited to 366 days. Use Sync All for full history."
        : ""
    : "";

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDay = (firstDay.getDay() + 6) % 7;

  const postsByDate = useMemo(() => {
    const grouped = new Map<string, Post[]>();
    posts.forEach((post) => {
      if (!post.date) return;
      const dayPosts = grouped.get(post.date) || [];
      dayPosts.push(post);
      grouped.set(post.date, dayPosts);
    });
    return grouped;
  }, [posts]);

  const selectedDayPosts = selectedDay ? postsByDate.get(selectedDay) || [] : [];

  useEffect(() => {
    const dismissPreview = () => setPreview(null);
    const dismissPreviewOnOutsideScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".cal-preview")) return;
      dismissPreview();
    };
    window.addEventListener("resize", dismissPreview);
    window.addEventListener("scroll", dismissPreviewOnOutsideScroll, true);
    return () => {
      window.removeEventListener("resize", dismissPreview);
      window.removeEventListener("scroll", dismissPreviewOnOutsideScroll, true);
    };
  }, []);

  useEffect(() => () => {
    if (hoverCloseTimer.current !== null) window.clearTimeout(hoverCloseTimer.current);
  }, []);

  const cancelPreviewClose = () => {
    if (hoverCloseTimer.current === null) return;
    window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = null;
  };

  const schedulePreviewClose = (key: string) => {
    cancelPreviewClose();
    hoverCloseTimer.current = window.setTimeout(() => {
      setPreview((current) => current?.key === key && !current.pinned ? null : current);
      hoverCloseTimer.current = null;
    }, 120);
  };

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPreview(null);
      setSelectedDay(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, []);

  const previewPosition = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const below = window.innerHeight - rect.bottom;
    const opensBelow = below >= 260;
    const maxHeight = Math.min(360, Math.max(160, opensBelow ? below - 18 : rect.top - 18));
    const top = opensBelow
      ? rect.bottom + 6
      : Math.max(12, rect.top - maxHeight - 6);
    return { left, top, maxHeight };
  };

  const showPreview = (
    key: string,
    platform: Platform,
    platformPosts: Post[],
    element: HTMLElement,
    pinned: boolean,
  ) => {
    if (!pinned && preview?.pinned) return;
    const position = previewPosition(element);
    setPreview({ key, platform, posts: platformPosts, ...position, pinned });
  };

  const handlePlatformClick = (
    event: React.MouseEvent<HTMLButtonElement>,
    key: string,
    platform: Platform,
    platformPosts: Post[],
  ) => {
    event.stopPropagation();
    if (preview?.key === key && preview.pinned) {
      setPreview(null);
      return;
    }
    showPreview(key, platform, platformPosts, event.currentTarget, true);
  };

  const openPostInTable = (post: Post) => {
    setPreview(null);
    setSelectedDay(null);
    onJumpToTable(post.id, post.platform);
  };

  const cells: React.ReactNode[] = [];
  for (let index = 0; index < startDay; index += 1) {
    cells.push(<div key={`empty-start-${index}`} className="cal-cell cal-cell-dim" />);
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayPosts = postsByDate.get(date) || [];
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const isToday = today === date;

    const openDay = () => {
      setPreview(null);
      if (dayPosts.length > 0) setSelectedDay(date);
      else onAddPost({ date });
    };

    cells.push(
      <div
        key={date}
        className={`cal-cell${isToday ? " cal-cell-today" : ""}`}
        role="button"
        tabIndex={0}
        aria-label={`${date}, ${dayPosts.length} post${dayPosts.length === 1 ? "" : "s"}`}
        onClick={openDay}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openDay();
          }
        }}
        onDragOver={(event) => {
          if (onMovePost) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!onMovePost) return;
          event.preventDefault();
          event.stopPropagation();
          const postId = event.dataTransfer.getData("text/post-id");
          if (postId) onMovePost(postId, date);
        }}
      >
        <div className="cal-cell-head"><span className="cal-cell-num">{day}</span></div>
        <div className="cal-chip-list">
          {PLATFORMS.map((platform) => {
            const platformPosts = dayPosts.filter((post) => post.platform === platform);
            if (!platformPosts.length) return null;
            const key = `${date}-${platform}`;
            return (
              <button
                type="button"
                key={platform}
                className={`cal-platform-btn${preview?.key === key ? " preview-open" : ""}`}
                onClick={(event) => handlePlatformClick(event, key, platform, platformPosts)}
                onMouseEnter={(event) =>
                  (cancelPreviewClose(), showPreview(key, platform, platformPosts, event.currentTarget, false))
                }
                onMouseLeave={() => schedulePreviewClose(key)}
                aria-label={`${platformDataMap[platform].name}, ${platformPosts.length} post${platformPosts.length === 1 ? "" : "s"}`}
              >
                <PlatformIcon platform={platform} />
                <span>{platformDataMap[platform].name}</span>
                <strong className="platform-count">{platformPosts.length}</strong>
              </button>
            );
          })}
        </div>
      </div>,
    );
  }

  while (cells.length % 7 !== 0) {
    cells.push(<div key={`empty-end-${cells.length}`} className="cal-cell cal-cell-dim" />);
  }

  return (
    <>
      <div className="cal-sync-bar">
        <div className="cal-sync-heading">
          <strong>{monthSync.running ? "Synchronizing" : "Metrics sync"}</strong>
          <span>{monthSync.monthLabel || new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(new Date(year, month, 1))}</span>
        </div>
        {Object.keys(monthSync.results).length > 0 && (
          <div className="cal-sync-results" aria-live="polite">
            {(["ig", "th", "fb", "yt"] as MetricsSyncPlatform[]).map((platform) => {
              const result = monthSync.results[platform];
              if (!result) return null;
              const statusLabel = result.status.charAt(0).toUpperCase() + result.status.slice(1);
              return (
                <div className={`cal-sync-result is-${result.status}`} key={platform} title={result.message || ""}>
                  <PlatformIcon platform={platform} iconOnly />
                  <span>{platformDataMap[platform].name}</span>
                  <b>{statusLabel}</b>
                  <small>{result.status === "running" ? "Discovering…" : `${result.discovered} found · ${result.added} added · ${result.existing} existing`}</small>
                  {result.status !== "running" && <small>{result.processed}/{result.discovered} processed{result.failed ? ` · ${result.failed} failed` : ""}{result.snapshotFailures ? ` · ${result.snapshotFailures} snapshot` : ""}</small>}
                </div>
              );
            })}
          </div>
        )}
        <div className="cal-sync-controls">
          <div className="cal-sync-options" aria-label="Sync date range">
            {(["7d", "30d", "90d", "custom", "all"] as CalendarSyncPreset[]).map((preset) => (
              <button key={preset} type="button" className={syncPreset === preset ? "active" : ""} onClick={() => setSyncPreset(preset)} disabled={monthSync.running}>
                {preset === "custom" ? "Custom" : preset === "all" ? "Sync All" : `${preset.slice(0, -1)} Days`}
              </button>
            ))}
          </div>
          {syncPreset === "custom" && (
            <div className="cal-sync-custom">
              <label>From <input type="date" value={syncStartDate} onChange={(event) => setSyncStartDate(event.target.value)} disabled={monthSync.running} /></label>
              <span>→</span>
              <label>To <input type="date" value={syncEndDate} onChange={(event) => setSyncEndDate(event.target.value)} disabled={monthSync.running} /></label>
              {customSyncError && <small>{customSyncError}</small>}
            </div>
          )}
        </div>
        <button className="btn-secondary cal-sync-button" type="button" onClick={() => onSync({ preset: syncPreset, startDate: syncStartDate, endDate: syncEndDate })} disabled={monthSync.running || Boolean(customSyncError)}>
          {monthSync.running ? "Syncing…" : "Sync"}
        </button>
      </div>
      <div className="cal-weekdays" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
          <div className="cal-weekday" key={weekday}>{weekday}</div>
        ))}
      </div>
      <div className="cal-grid">{cells}</div>

      {preview && (
        <div
          className="cal-preview preview-open"
          style={{ left: preview.left, top: preview.top, maxHeight: preview.maxHeight }}
          onClick={(event) => event.stopPropagation()}
          onMouseEnter={cancelPreviewClose}
          onMouseLeave={() => schedulePreviewClose(preview.key)}
        >
          <div className="cal-preview-header">
            <PlatformIcon platform={preview.platform} />
            <span>{platformDataMap[preview.platform].name}</span>
            <span className="cal-preview-count">{preview.posts.length}</span>
            {preview.pinned && (
              <button type="button" className="cal-preview-close" onClick={() => setPreview(null)}>
                ×
              </button>
            )}
          </div>
          <div className="cal-preview-list">
            {preview.posts.map((post) => (
              <button
                type="button"
                key={post.id}
                className="cal-preview-item"
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/post-id", post.id);
                  event.dataTransfer.effectAllowed = "move";
                }}
                onClick={() => openPostInTable(post)}
              >
                {canShowThumbnail(post) && (
                  <img
                    src={post.mediaUrl || undefined}
                    alt=""
                    loading="lazy"
                    onError={(event) => {
                      event.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <span className="cal-preview-copy">
                  <span className="cal-preview-meta">
                    <span>{post.contentType || "Post"}</span>
                    <span>{timeLabel(post)}</span>
                    <span className={`status-badge ${getStatusClass(post.status)}`}>{getStatusLabel(post.status)}</span>
                  </span>
                  <span className="cal-preview-text">{truncate(postPreview(post), 110)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {selectedDay && (
        <div className="overlay" onMouseDown={() => setSelectedDay(null)}>
          <section
            className="panel cal-day-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cal-day-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="cal-day-panel-header">
              <div>
                <h3 id="cal-day-title">
                  {new Date(`${selectedDay}T00:00:00`).toLocaleDateString([], {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </h3>
                <div className="cal-day-panel-subtitle">
                  {selectedDayPosts.length} post{selectedDayPosts.length === 1 ? "" : "s"}
                </div>
              </div>
              <button type="button" className="cal-preview-close" onClick={() => setSelectedDay(null)}>
                ×
              </button>
            </div>
            <div className="cal-day-groups">
              {PLATFORMS.map((platform) => {
                const platformPosts = selectedDayPosts.filter((post) => post.platform === platform);
                if (!platformPosts.length) return null;
                return (
                  <div className="cal-day-group" key={platform}>
                    <div className="cal-day-group-title">
                      <PlatformIcon platform={platform} />
                      <span>{platformDataMap[platform].name}</span>
                      <span>{platformPosts.length}</span>
                    </div>
                    {platformPosts.map((post) => (
                      <button
                        type="button"
                        className="cal-day-post"
                        key={post.id}
                        onClick={() => openPostInTable(post)}
                      >
                        {canShowThumbnail(post) && (
                          <img
                            src={post.mediaUrl || undefined}
                            alt=""
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        )}
                        <span className="cal-day-post-copy">
                          <span className="cal-preview-meta">
                            <span>{post.contentType || "Post"}</span>
                            <span>{timeLabel(post)}</span>
                            <span className={`status-badge ${getStatusClass(post.status)}`}>{getStatusLabel(post.status)}</span>
                          </span>
                          <span>{truncate(postPreview(post), 150)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="panel-actions">
              <button type="button" className="btn-secondary" onClick={() => setSelectedDay(null)}>
                Close
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  const date = selectedDay;
                  setSelectedDay(null);
                  onAddPost({ date });
                }}
              >
                Add post
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
};
