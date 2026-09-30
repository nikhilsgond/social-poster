// src/components/Tables/Tables.tsx
import React, { useEffect, useMemo } from "react";
import { PlatformIcon, platformDataMap, Platform } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import type { Post } from "../../types/post";
import { getStatusLabel, getStatusClass, STATUS_OPTIONS } from "../../types/post";
import { FIELD_SCHEMA, METRIC_FIELDS } from "../../lib/contentTypes";

const PLATFORMS: Platform[] = ["yt", "ig", "fb", "th", "li", "x"];

interface TablesProps {
  currentTab: Platform | "all";
  onTabChange: (tab: Platform | "all") => void;
  tableSearch: string;
  onSearchChange: (val: string) => void;
  tableContentType: string;
  onContentTypeChange: (val: string) => void;
  tableStatus: string;
  onStatusChange: (val: string) => void;
  tableSort: string;
  onSortChange: (val: string) => void;
  tableSortDir: string;
  onSortDirChange: () => void;
  selectionMode: boolean;
  onEnterDeleteMode: () => void;
  onExitDeleteMode: () => void;
  onDeleteSelected: () => void;
  onExportJSON: () => void;
  onExportCSV: () => void;
  onPrint: () => void;
  onEditPost: (post: Post) => void;
  onViewPost: (post: Post) => void;
  onDeletePost: (id: string) => void;
  onReusePost: (post: Post) => void;
  onClearFilters: () => void;
  selectedPosts: Record<string, boolean>;
  onToggleSelect: (id: string) => void;
  posts: Post[];
  pageSize: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  focusPostId?: string | null;
}

export interface TablePostQuery {
  currentTab: Platform | "all";
  tableSearch: string;
  tableContentType: string;
  tableStatus: string;
  tableSort: string;
  tableSortDir: string;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  // @ts-ignore
  return str.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
}

function truncate(str: string, n: number): string {
  if (!str) return "";
  return str.length > n ? str.slice(0, n - 1) + "\u2026" : str;
}

function relativeTime(ts: string | null | undefined): string {
  if (!ts) return "\u2014";
  const diff = Date.now() - Number(ts);
  const min = 60000, hr = 3600000, day = 86400000;
  if (diff < min) return "just now";
  if (diff < hr) return Math.floor(diff / min) + "m ago";
  if (diff < day) return Math.floor(diff / hr) + "h ago";
  if (diff < day * 30) return Math.floor(diff / day) + "d ago";
  return new Date(Number(ts)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function metricNumber(post: Post | null, key: string): number {
  const v = post ? Number((post as any)[key]) : 0;
  return Number.isFinite(v) ? v : 0;
}

export function getFilteredSortedPosts(posts: Post[], query: TablePostQuery): Post[] {
  const search = query.tableSearch.trim().toLowerCase();
  return posts.filter((post) => {
    if (query.currentTab !== "all" && post.platform !== query.currentTab) return false;
    if (query.tableContentType !== "all" && String(post.contentType || "") !== query.tableContentType) return false;
    if (query.tableStatus !== "all" && post.status !== query.tableStatus) return false;
    if (search) {
      const schema = FIELD_SCHEMA[post.platform] || FIELD_SCHEMA.x;
      const fields = schema.map((field) => (post as any)[field.key] || "").join(" ");
      const haystack = `${post.platform} ${post.contentType || ""} ${fields} ${post.title || post.topic || post.content || ""}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  }).sort((a, b) => {
    const direction = query.tableSortDir === "desc" ? -1 : 1;
    if (query.tableSort === "views" || query.tableSort === "likes" || query.tableSort === "comments") {
      return (metricNumber(a, query.tableSort) - metricNumber(b, query.tableSort)) * direction;
    }
    if (query.tableSort === "platform") {
      return platformDataMap[a.platform].name.localeCompare(platformDataMap[b.platform].name) * direction;
    }
    if (query.tableSort === "contentType") return (a.contentType || "").localeCompare(b.contentType || "") * direction;
    if (query.tableSort === "status") return (a.status || "").localeCompare(b.status || "") * direction;
    if (query.tableSort === "publishedAt") return (a.publishedAt || "").localeCompare(b.publishedAt || "") * direction;
    return `${a.date || ""} ${a.time || "99:99"}`.localeCompare(`${b.date || ""} ${b.time || "99:99"}`) * direction;
  });
}

function prettyDateShort(dateStr: string): string {
  if (!dateStr) return "\u2014";
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

function formatPublishedAt(publishedAt: string | null | undefined): string {
  if (!publishedAt) return "\u2014";
  const parts = publishedAt.split("T");
  const datePart = prettyDateShort(parts[0]);
  const timePart = parts[1] ? parts[1].slice(0, 5) : "";
  return timePart ? `${datePart} \u00b7 ${timePart}` : datePart;
}

export const Tables: React.FC<TablesProps> = ({
  currentTab, onTabChange, tableSearch, onSearchChange,
  tableContentType, onContentTypeChange, tableStatus, onStatusChange,
  tableSort, onSortChange, tableSortDir, onSortDirChange,
  selectionMode, onEnterDeleteMode, onExitDeleteMode, onDeleteSelected,
  onExportJSON, onExportCSV, onPrint, onEditPost, onViewPost, onDeletePost, onReusePost, onClearFilters,
  selectedPosts, onToggleSelect, posts, pageSize, currentPage, onPageChange, focusPostId,
}) => {
  const { showToast } = useToast();
  const isAllView = currentTab === "all";

  // ── Filter & Sort ──
  const filteredPosts = useMemo(() => getFilteredSortedPosts(posts, {
    currentTab,
    tableSearch,
    tableContentType,
    tableStatus,
    tableSort,
    tableSortDir,
  }), [posts, currentTab, tableSearch, tableContentType, tableStatus, tableSort, tableSortDir]);

  // ── Pagination (client-side on filtered results) ──
  const totalFiltered = filteredPosts.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const paginatedPosts = filteredPosts.slice(startIndex, startIndex + pageSize);

  useEffect(() => {
    if (!focusPostId || !paginatedPosts.some((post) => post.id === focusPostId)) return;
    const frame = window.requestAnimationFrame(() => {
      const row = document.getElementById(`table-row-${focusPostId}`);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      row?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusPostId, paginatedPosts]);

  const sourceForTypes = isAllView ? posts : posts.filter((p) => p.platform === currentTab);
  const selectedCount = Object.keys(selectedPosts).filter((id) => selectedPosts[id]).length;
  const allSelected = paginatedPosts.length > 0 && paginatedPosts.every((p) => !!selectedPosts[p.id]);

  function tableTypeOptions(pl: Post[]) {
    const seen: Record<string, boolean> = { all: true };
    const vals: string[] = ["all"];
    pl.forEach((p) => { const t = String(p.contentType || "").trim(); if (t && !seen[t]) { seen[t] = true; vals.push(t); } });
  // @ts-ignore
    return vals.map((v) => <option key={v} value={v} selected={tableContentType === v ? true : undefined}>{v === "all" ? "All content types" : escapeHtml(v)}</option>);
  }

  const title = isAllView ? "All Platforms" : platformDataMap[currentTab as Platform].name;
  const platformSchema = isAllView ? null : FIELD_SCHEMA[currentTab as Platform];
  const headSchemaFields = platformSchema
    ? platformSchema.map((f) => <th key={f.key}>{escapeHtml(f.label)}</th>)
    : null;
  const headMetrics = METRIC_FIELDS.map((m) => <th key={m.key}>{escapeHtml(m.label)}</th>);

  // Column count for empty-row colSpan:
  // [checkbox] + [platform(all)] + Date + Time + Status + [ContentType+Preview(all)|schema] + published + postID + socialUrl + metrics(3) + updated + actions
  const colCount = (selectionMode ? 1 : 0)
    + (isAllView ? 1 : 0)  // Platform column (all view only)
    + 3  // Date, Time, Status
    + (isAllView ? 2 : 0)  // ContentType + Preview (all view only)
    + (platformSchema ? platformSchema.length : 0)  // schema fields (platform view)
    + 1 + 1 + 1  // Published, PlatformPostId, SocialUrl
    + METRIC_FIELDS.length
    + 1 + 1;

  function metricVal(p: Post, key: string): string {
    const v = (p as any)[key];
    return (v !== undefined && v !== null && v !== "") ? String(v) : "\u2014";
  }

  function renderRow(p: Post) {
    const selected = !!selectedPosts[p.id];
    const checkbox = selectionMode
      ? <td style={{ width: 38 }} key={p.id + "_cb"}>
          <input className="select-post" type="checkbox" data-action="select-post" data-id={p.id}
            checked={selected} readOnly />
        </td>
      : null;

    const metricCells = METRIC_FIELDS.map((m) => <td key={m.key} className="num">{metricVal(p, m.key)}</td>);
    const publishedCell = <td className="num">{formatPublishedAt(p.publishedAt)}</td>;
    const platformPostIdCell = <td className="num" title={p.platformPostId || ""}>{escapeHtml(p.platformPostId || "\u2014")}</td>;
    const socialUrlCell = (
      <td>
        {p.socialUrl
          ? <a href={p.socialUrl} target="_blank" rel="noopener noreferrer" className="link-cell" title={p.socialUrl}>{escapeHtml(truncate(p.socialUrl, 40))}</a>
          : <span className="dim">\u2014</span>}
      </td>
    );

    const rowOnClick = selectionMode
      ? undefined
      : (e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.closest(".select-post") || target.closest("[data-row-control]")) return;
          onViewPost(p);
        };

    if (isAllView) {
      // ── All Platforms row ──
      return (
        <tr key={p.id} id={`table-row-${p.id}`} data-post-row={p.id} tabIndex={-1}
            className={`${selected ? "selected-row " : ""}${focusPostId === p.id ? "row-highlight" : ""}`.trim()} onClick={rowOnClick}>
          {checkbox}
          <td>{<PlatformIcon platform={p.platform} iconOnly />}{escapeHtml(platformDataMap[p.platform].name)}</td>
          <td className="num">{prettyDateShort(p.date)}</td>
          <td className="num">{escapeHtml(p.time || "\u2014")}</td>
          <td><span className={`status-badge ${getStatusClass(p.status)}`}>{getStatusLabel(p.status)}</span></td>
          <td className="num">{escapeHtml(p.contentType || "\u2014")}</td>
          <td>
            <div className="table-cell-preview" title={escapeHtml(getPreview(p) || "")}>{escapeHtml(truncate(getPreview(p), 90))}</div>
          </td>
          {publishedCell}
          {platformPostIdCell}
          {socialUrlCell}
          {metricCells}
          <td>{relativeTime(p.metricsUpdatedAt)}</td>
          <td data-row-control="true"><div className="table-row-actions"><button type="button" className="btn-secondary" data-action="edit-post" data-id={p.id} onClick={(e) => { e.stopPropagation(); onEditPost(p); }}>Edit</button><button type="button" className="btn-secondary" onClick={(e) => { e.stopPropagation(); onReusePost(p); }}>Reuse</button></div></td>
        </tr>
      );
    }

    // ── Platform-specific row ──
    const fieldCells = platformSchema
      ? platformSchema.map((f) => {
          const val = (p as any)[f.key] || "\u2014";
          return <td key={f.key}><div className="table-cell-preview" title={escapeHtml(val)}>{escapeHtml(val)}</div></td>;
        })
      : null;

    return (
      <tr key={p.id} id={`table-row-${p.id}`} data-post-row={p.id} tabIndex={-1}
          className={`${selected ? "selected-row " : ""}${focusPostId === p.id ? "row-highlight" : ""}`.trim()} onClick={rowOnClick}>
        {checkbox}
        <td className="num">{prettyDateShort(p.date)}</td>
        <td className="num">{escapeHtml(p.time || "\u2014")}</td>
        <td><span className={`status-badge ${getStatusClass(p.status)}`}>{getStatusLabel(p.status)}</span></td>
        {fieldCells}
        {publishedCell}
        {platformPostIdCell}
        {socialUrlCell}
        {metricCells}
        <td>{relativeTime(p.metricsUpdatedAt)}</td>
        <td data-row-control="true"><div className="table-row-actions"><button type="button" className="btn-secondary" data-action="edit-post" data-id={p.id} onClick={(e) => { e.stopPropagation(); onEditPost(p); }}>Edit</button><button type="button" className="btn-secondary" onClick={(e) => { e.stopPropagation(); onReusePost(p); }}>Reuse</button></div></td>
      </tr>
    );
  }

  const emptyRow = totalFiltered === 0 ? <tr><td colSpan={colCount} className="empty-note">No posts match the current filters.</td></tr> : null;

  return (
    <div>
      <div className="table-toolbar">
        <div>
          <h2 className="table-title" style={{ margin: 0, fontSize: "1.35rem", letterSpacing: "-0.02em" }}>
            {!isAllView && <PlatformIcon platform={currentTab} iconOnly />}{title}
          </h2>
          <div style={{ color: "var(--muted)", fontSize: ".76rem", marginTop: 3 }}>
            {totalFiltered} matching post{totalFiltered !== 1 ? "s" : ""} \u00b7 Click any row to view details, Edit to modify
          </div>
        </div>
        <div className="table-tabs">
          <button type="button" className={`table-tab ${isAllView ? " active" : ""}`} data-action="table-tab" data-platform="all" onClick={() => onTabChange("all")}>All Platforms</button>
          {PLATFORMS.map((p) => (
            <button key={p} type="button" className={`table-tab ${currentTab === p ? " active" : ""}`} data-action="table-tab" data-platform={p} onClick={() => onTabChange(p)}>
              <PlatformIcon platform={p} iconOnly /> {platformDataMap[p].name}
            </button>
          ))}
        </div>
      </div>

      <div className="table-filters">
        <input type="search" id="tableSearch" value={tableSearch} placeholder="Search posts, topics, captions, titles\u2026" aria-label="Search posts" onChange={(e) => onSearchChange(e.target.value)} />
        <select id="tableContentType" aria-label="Filter by content type" value={tableContentType} onChange={(e) => onContentTypeChange(e.target.value)}>
          {tableTypeOptions(sourceForTypes)}
        </select>
        <select id="tableStatus" aria-label="Filter by status" value={tableStatus} onChange={(e) => onStatusChange(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select id="tableSort" aria-label="Sort posts" value={tableSort} onChange={(e) => onSortChange(e.target.value)}>
          <option value="date">Sort: Scheduled date</option>
          <option value="publishedAt">Sort: Published date</option>
          <option value="views">Sort: Views</option>
          <option value="likes">Sort: Likes</option>
          <option value="comments">Sort: Comments</option>
          <option value="platform">Sort: Platform</option>
          <option value="contentType">Sort: Content type</option>
          <option value="status">Sort: Status</option>
        </select>
        <button type="button" className="btn-secondary btn-mini" data-action="sort-direction" onClick={onSortDirChange}>
          {tableSortDir === "desc" ? "Descending" : "Ascending"}
        </button>
        <button type="button" className="btn-secondary btn-mini filter-clear" data-action="clear-table-filters" onClick={onClearFilters}>Clear</button>
        <span className="table-filter-count">{filteredPosts.length} result{filteredPosts.length !== 1 ? "s" : ""}</span>
      </div>

      {selectionMode ? (
        <div className="selection-toolbar">
          <span className="selection-count">{selectedCount} selected</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: ".74rem", color: "var(--muted)" }}>
            <input className="select-post" type="checkbox" data-action="select-all-visible" checked={allSelected} readOnly /> Select all visible
          </label>
          <button type="button" className="btn-danger" data-action="delete-selected" onClick={onDeleteSelected} disabled={!selectedCount}>Delete selected</button>
          <button type="button" className="btn-secondary" data-action="exit-delete-mode" onClick={onExitDeleteMode}>Cancel</button>
        </div>
      ) : (
        <div className="selection-toolbar">
          <span className="selection-count">Delete mode is off</span>
          <div className="toolbar-mini">
            <button type="button" className="btn-danger" data-action="enter-delete-mode" onClick={onEnterDeleteMode}>Delete</button>
            <button type="button" className="btn-secondary btn-mini" data-action="export-json" onClick={onExportJSON}>Export JSON</button>
            <button type="button" className="btn-secondary btn-mini" data-action="export-csv" onClick={onExportCSV}>Export CSV</button>
            <button type="button" className="btn-secondary btn-mini" data-action="print-table" onClick={onPrint}>Print / PDF</button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              {selectionMode && <th style={{ width: 38 }} />}
              {isAllView && <th>Platform</th>}
              <th>Scheduled Date</th>
              <th>Time</th>
              <th>Status</th>
              {isAllView ? <><th>Content Type</th><th>Preview</th></> : headSchemaFields}
              <th>Published</th>
              <th>Platform Post ID</th>
              <th>Social URL</th>
              {headMetrics}
              <th>Metrics Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {paginatedPosts.map((p) => renderRow(p))}
            {emptyRow}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {totalFiltered > 0 && (
        <div className="table-pagination">
          <span className="page-info">
            {((safePage - 1) * pageSize + 1)}
            {"\u2013"}
            {Math.min(safePage * pageSize, totalFiltered)} of {totalFiltered} posts
          </span>
          <div className="page-controls">
            <button type="button" className="btn-secondary btn-mini" onClick={() => onPageChange(1)} disabled={safePage === 1}>First</button>
            <button type="button" className="btn-secondary btn-mini" onClick={() => onPageChange(safePage - 1)} disabled={safePage === 1}>Prev</button>
            <span style={{ color: "var(--muted)", fontSize: ".72rem" }}>Page {safePage} of {totalPages}</span>
            <button type="button" className="btn-secondary btn-mini" onClick={() => onPageChange(safePage + 1)} disabled={safePage === totalPages}>Next</button>
            <button type="button" className="btn-secondary btn-mini" onClick={() => onPageChange(totalPages)} disabled={safePage === totalPages}>Last</button>
          </div>
        </div>
      )}
    </div>
  );
};
