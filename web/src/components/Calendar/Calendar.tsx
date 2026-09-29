// src/components/Calendar/Calendar.tsx
import React, { useState, useCallback, useRef, useEffect } from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import type { Platform, Post } from "../../types/post";
import { FIELD_SCHEMA, METRIC_FIELDS, CONTENT_TYPES } from "../../lib/contentTypes";
import { getStatusLabel, getStatusClass } from "../../types/post";

const PLATFORMS: Platform[] = ["yt", "ig", "fb", "th", "li", "x"];
const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface CalendarProps {
  currentMonth: { year: number; month: number };
  onNavMonth: (delta: number) => void;
  onGoToday: () => void;
  onAddPost: (preset?: { date?: string; platform?: Platform }) => void;
  onView: (view: "tables") => void;
  onJumpToTable: (postId: string, platform: Platform) => void;
  onViewPost: (post: Post) => void;
  posts: Post[];
  selectedPosts: Record<string, boolean>;
  onToggleSelect: (id: string) => void;
  dragPostId: string | null;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (date: string) => void;
}

export const Calendar: React.FC<CalendarProps> = ({
  currentMonth, onNavMonth, onGoToday, onAddPost, onView, onJumpToTable, onViewPost,
  posts, selectedPosts, onToggleSelect, dragPostId, onDragStart, onDragEnd, onDrop,
}) => {
  const { showToast } = useToast();
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [previewPos, setPreviewPos] = useState<{ left: number; top: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  function buildMonthGrid(year: number, month: number): Array<{ date: Date; otherMonth: boolean; num: number }> {
    const first = new Date(year, month, 1);
    const startWeekday = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: Array<{ date: Date; otherMonth: boolean; num: number }> = [];
    for (let i = 0; i < startWeekday; i++) {
      const num = daysInMonth - startWeekday + 1 + i;
      cells.push({ date: new Date(year, month - 1, num), otherMonth: true, num });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), otherMonth: false, num: d });
    }
    const trailingDays = (7 - (cells.length % 7)) % 7;
    for (let t = 1; t <= trailingDays; t++) {
      cells.push({ date: new Date(year, month + 1, t), otherMonth: true, num: t });
    }
    return cells;
  }

  function formatDate(d: Date): string {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function prettyDateShort(dateStr: string): string {
    const parts = dateStr.split("-");
    const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function getPreview(post: Post): string {
    switch (post.platform) {
      case "yt": return post.title || "";
      case "ig": return post.caption || post.topic || "";
      case "fb": return post.content || post.topic || "";
      default: return post.content || post.topic || "";
    }
  }

  function truncate(str: string, n: number): string {
    if (!str) return "";
    return str.length > n ? str.slice(0, n - 1) + "\u2026" : str;
  }

  function escapeHtml(str: string): string {
    if (!str) return "";
    // @ts-ignore
    return (str as string).replace(/[&<>"']/g, (c: string): string => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;");
  }

  // ── Status Helpers ──
  // Status now comes from post.status, not date comparison
  const cells = buildMonthGrid(currentMonth.year, currentMonth.month);
  const todayStr = formatDate(new Date());
  const numRows = cells.length / 7;
  function toggleGroup(platKey: string) {
    setOpenGroup((prev) => (prev === platKey ? null : platKey));
  }

  function positionPreview(groupEl: HTMLElement) {
    const btn = groupEl.querySelector(".cal-platform-btn") as HTMLElement;
    const preview = groupEl.querySelector(".cal-preview") as HTMLElement;
    if (!btn || !preview) return;
    const r = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const gap = 6;
    const width = Math.min(270, vw - 28);
    preview.style.width = width + "px";
    preview.style.maxWidth = width + "px";
    preview.style.visibility = "hidden";
    preview.style.display = "block";
    const h = Math.min(preview.scrollHeight, 360);
    let left = Math.max(14, Math.min(r.left, vw - width - 14));
    let top = r.bottom + gap;
    if (top + h > window.innerHeight - 14) top = Math.max(14, r.top - h - gap);
    preview.style.left = Math.round(left) + "px";
    preview.style.top = Math.round(top) + "px";
    preview.style.visibility = "";
    preview.style.display = "";
  }

  function handleDayClick(dateStr: string, e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest(".cal-platform-group")) return;
    onAddPost({ date: dateStr });
  }

  function handlePlatformClick(platKey: string, dateStr: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const group = (e.target as HTMLElement).closest(".cal-platform-group") as HTMLElement;
    if (!group) return;
    const wasOpen = group.classList.contains("open");
    document.querySelectorAll(".cal-platform-group.open").forEach((g) => {
      g.classList.remove("open");
      const c = g.closest(".cal-cell");
      if (c) c.classList.remove("cal-cell-open", "cal-cell-preview-open");
    });
    if (!wasOpen) {
      group.classList.add("open");
      const cell = group.closest(".cal-cell");
      if (cell) cell.classList.add("cal-cell-open");
      positionPreview(group);
    }
  }

  function handleDragOver(e: React.DragEvent, cell: HTMLElement) {
    e.preventDefault();
    if (!cell.classList.contains("cal-cell-dim")) cell.classList.add("drag-over");
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }

  function handleDragLeave(e: React.DragEvent, cell: HTMLElement) {
    if (cell && e.relatedTarget && !cell.contains(e.relatedTarget as Node)) cell.classList.remove("drag-over");
  }

  function handleDrop(e: React.DragEvent, cell: HTMLElement) {
    e.preventDefault();
    cell.classList.remove("drag-over");
    const id = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || dragPostId;
    if (!id) return;
    const post = posts.find((p) => p.id === id);
    if (!post || cell.classList.contains("cal-cell-dim")) return;
    const newDate = cell.getAttribute("data-date");
    if (!newDate || post.date === newDate) return;
    onDrop(newDate);
  }

  return (
    <div>
      {posts.length === 0 && (
        <div className="hint-bar">Nothing planned yet. Click Add Post, or click any day to add one there.</div>
      )}
      <div className="cal-weekdays">
        {WEEKDAY_NAMES.map((w) => (
          <div className="cal-weekday" key={w}>{w}</div>
        ))}
      </div>
      <div className="cal-grid" ref={gridRef} style={{ gridTemplateRows: `repeat(${numRows}, 1fr)` }}>
        {cells.map((cell, idx) => {
          const dateStr = formatDate(cell.date);
          const isToday = dateStr === todayStr;
          const dayPosts = cell.otherMonth ? [] : posts.filter((p) => p.date === dateStr).sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
          const cellPosts = selectedPosts;

          const groups = PLATFORMS.map((plat) => {
            const platPosts = dayPosts.filter((p) => p.platform === plat);
            if (!platPosts.length) return null;
            const isOpen = openGroup === plat;
            const items = platPosts.map((p) => (
              <button
                key={p.id}
                type="button"
                className="cal-preview-item"
                draggable
                data-drag-post={p.id}
                data-id={p.id}
                data-platform={p.platform}
                data-action="jump-table"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onViewPost(p); }}
                onDragStart={(e) => {
                  e.stopPropagation();
                  onDragStart(p.id);
                  (e.target as HTMLElement).classList.add("dragging");
                  if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", p.id); }
                }}
                onDragEnd={(e) => {
                  (e.target as HTMLElement).classList.remove("dragging");
                  if (gridRef.current) gridRef.current.querySelectorAll(".drag-over").forEach((c) => c.classList.remove("drag-over"));
                  onDragEnd();
                }}
              >
                <div className="cal-preview-meta">
                  <span>{prettyDateShort(p.date)}{p.time ? ` \u00b7 ${p.time}` : ""}</span>
                  {p.contentType ? <span className="cal-preview-type">{escapeHtml(p.contentType)}</span> : ""}
                  <span className={`status-badge ${getStatusClass(p.status)}`}>{getStatusLabel(p.status)}</span>
                </div>
                <div className="cal-preview-post-title">{escapeHtml(truncate(getPreview(p), 80))}</div>
              </button>
            )).join("");

            return (
              <div key={plat} className={`cal-platform-group${isOpen ? " open" : ""}`} data-platform-group={plat}>
                <button
                  type="button"
                  className="cal-platform-btn"
                  data-action="calendar-platform"
                  data-platform={plat}
                  data-date={dateStr}
                  onClick={(e) => handlePlatformClick(plat, dateStr, e)}
                >
                  <PlatformIcon platform={plat} iconOnly />
                  <span>{platformDataMap[plat].name}</span>
                  <span className="platform-count">{platPosts.length}</span>
                </button>
                <div className="cal-preview">
                  <div className="cal-preview-title">{platformDataMap[plat].name} · {platPosts.length} post{platPosts.length === 1 ? "" : "s"}</div>
                  {items}
                </div>
              </div>
            );
          }).filter(Boolean).join("");

          const classes = `cal-cell${cell.otherMonth ? " cal-cell-dim" : ""}${isToday ? " cal-cell-today" : ""}`;
          return (
            <div
              key={idx}
              className={classes}
              tabIndex={0}
              data-date={dateStr}
              data-action="day"
              onClick={(e) => handleDayClick(dateStr, e)}
              onDragOver={(e) => handleDragOver(e, e.currentTarget as HTMLElement)}
              onDragLeave={(e) => handleDragLeave(e, e.currentTarget as HTMLElement)}
              onDrop={(e) => handleDrop(e, e.currentTarget as HTMLElement)}
            >
              <div className="cal-cell-head">
                <span className="cal-cell-num">{cell.num}</span>
              </div>
              <div className="cal-chip-list">{groups}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
