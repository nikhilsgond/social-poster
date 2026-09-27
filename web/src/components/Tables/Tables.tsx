// src/components/Tables/Tables.tsx
import React, { useMemo } from "react";
import { PlatformIcon, platformDataMap, Platform } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import type { Post } from "../../types/post";
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
  onDeletePost: (id: string) => void;
  onClearFilters: () => void;
  selectedPosts: Record<string, boolean>;
  onToggleSelect: (id: string) => void;
  posts: Post[];
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

function getStatus(dateStr: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return dateStr < today ? "posted" : "scheduled";
}

function prettyDateShort(dateStr: string): string {
  const parts = dateStr.split("-");
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

function formatMetric(n: number): string {
  n = Number(n) || 0;
  const abs = Math.abs(n);
  if (abs >= 1000000) return (n / 1000000).toFixed(abs >= 10000000 ? 0 : 1) + "M";
  if (abs >= 1000) return (n / 1000).toFixed(abs >= 100000 ? 0 : 1) + "K";
  return Math.round(n).toLocaleString();
}

function schemaFor(key: Platform) {
  return FIELD_SCHEMA[key] || FIELD_SCHEMA.x;
}

export const Tables: React.FC<TablesProps> = ({
  currentTab, onTabChange, tableSearch, onSearchChange,
  tableContentType, onContentTypeChange, tableStatus, onStatusChange,
  tableSort, onSortChange, tableSortDir, onSortDirChange,
  selectionMode, onEnterDeleteMode, onExitDeleteMode, onDeleteSelected,
  onExportJSON, onExportCSV, onPrint, onEditPost, onDeletePost, onClearFilters,
  selectedPosts, onToggleSelect, posts,
}) => {
  const { showToast } = useToast();

  const filteredPosts = useMemo(() => {
    const search = tableSearch.trim().toLowerCase();
    const platformFilter = currentTab;
    const typeFilter = tableContentType;
    const statusFilter = tableStatus;
    return posts.filter((p) => {
      if (platformFilter !== "all" && p.platform !== platformFilter) return false;
      if (typeFilter !== "all" && String(p.contentType || "") !== typeFilter) return false;
      if (statusFilter !== "all" && getStatus(p.date) !== statusFilter) return false;
      if (search) {
        const schema = schemaFor(p.platform);
        const fields = schema.map((f) => (p as any)[f.key] || "").join(" ");
        const hay = (p.platform + " " + (p.contentType || "") + " " + fields + " " + (p.title || p.topic || p.content || "")).toLowerCase();
        if (hay.indexOf(search) === -1) return false;
      }
      return true;
    }).sort((a, b) => {
      const dir = tableSortDir === "desc" ? -1 : 1;
      if (tableSort === "views" || tableSort === "likes" || tableSort === "comments") return (metricNumber(a, tableSort) - metricNumber(b, tableSort)) * dir;
      if (tableSort === "platform") return platformDataMap[a.platform].name.localeCompare(platformDataMap[b.platform].name) * dir;
      if (tableSort === "contentType") return (a.contentType || "").localeCompare(b.contentType || "") * dir;
      return ((a.date || "") + " " + (a.time || "99:99")).localeCompare((b.date || "") + " " + (b.time || "99:99")) * dir;
    });
  }, [posts, currentTab, tableSearch, tableContentType, tableStatus, tableSort, tableSortDir]);

  const sourceForTypes = currentTab === "all" ? posts : posts.filter((p) => p.platform === currentTab);
  const selectedCount = Object.keys(selectedPosts).filter((id) => selectedPosts[id]).length;
  const allSelected = filteredPosts.length > 0 && filteredPosts.every((p) => !!selectedPosts[p.id]);

  function tableTypeOptions(pl: Post[]) {
    const seen: Record<string, boolean> = { all: true };
    const vals: string[] = ["all"];
    pl.forEach((p) => { const t = String(p.contentType || "").trim(); if (t && !seen[t]) { seen[t] = true; vals.push(t); } });
  // @ts-ignore
    return vals.map((v) => <option key={v} value={v} selected={tableContentType === v ? true : undefined}>{v === "all" ? "All content types" : escapeHtml(v)}</option>);
  }

  const title = currentTab === "all" ? "All Platforms" : platformDataMap[currentTab as Platform].name;
  const allSchema = currentTab === "all" ? null : schemaFor(currentTab as Platform);
  const headFields = allSchema ? allSchema.map((f) => <th key={f.key}>{escapeHtml(f.label)}</th>) : null;
  const headMetrics = METRIC_FIELDS.map((m) => <th key={m.key}>{escapeHtml(m.label)}</th>);
  const colCount = (selectionMode ? 1 : 0) + (currentTab === "all" ? 1 : 0) + 3 + (allSchema ? allSchema.length : 0) + METRIC_FIELDS.length + 2;

  function metricVal(p: Post, key: string): string {
    const v = (p as any)[key];
    return (v !== undefined && v !== null && v !== "") ? String(v) : "—";
  }

  function renderAllRows() {
    return filteredPosts.map((p) => {
      const status = getStatus(p.date);
      const selected = !!selectedPosts[p.id];
      const checkbox = selectionMode ? <td style={{ width: 38 }} key={p.id + "_cb"}><input className="select-post" type="checkbox" data-action="select-post" data-id={p.id} checked={selected} readOnly /></td> : null;
      const metricCells = METRIC_FIELDS.map((m) => <td key={m.key}>{metricVal(p, m.key)}</td>);
      return (
        <tr key={p.id} id={`table-row-${p.id}`} data-post-row={p.id} className={selected ? "selected-row" : ""}>
          {checkbox}
          <td>{<PlatformIcon platform={p.platform} iconOnly />}{escapeHtml(platformDataMap[p.platform].name)}</td>
          <td>{prettyDateShort(p.date)}</td>
          <td>{escapeHtml(p.time || "—")}</td>
          <td><span className={`status-badge status-${status}`}>{status === "posted" ? "Posted" : "Scheduled"}</span></td>
          <td>{escapeHtml(p.contentType || "—")}</td>
          <td><div className="table-cell-preview" title={escapeHtml(p.title || p.topic || p.content || "")}>{escapeHtml(truncate(p.title || p.topic || p.content || "", 90))}</div></td>
          <td>{metricVal(p, "views")}</td>
          <td>{metricVal(p, "likes")}</td>
          <td>{metricVal(p, "comments")}</td>
          <td>{relativeTime(p.metricsUpdatedAt)}</td>
          <td data-row-control="true"><button type="button" className="btn-secondary" data-action="edit-post" data-id={p.id} onClick={() => onEditPost(p)}>Edit</button></td>
        </tr>
      );
    });
  }

  function renderPlatformRows() {
    return filteredPosts.map((p) => {
      const status = getStatus(p.date);
      const selected = !!selectedPosts[p.id];
      const checkbox = selectionMode ? <td style={{ width: 38 }} key={p.id + "_cb"}><input className="select-post" type="checkbox" data-action="select-post" data-id={p.id} checked={selected} readOnly /></td> : null;
      const fieldCells = allSchema ? allSchema.map((f) => {
        const val = (p as any)[f.key] || "—";
        return <td key={f.key}><div className="table-cell-preview" title={escapeHtml(val)}>{escapeHtml(val)}</div></td>;
      }) : null;
      const metricCells = METRIC_FIELDS.map((m) => <td key={m.key}>{metricVal(p, m.key)}</td>);
      return (
        <tr key={p.id} id={`table-row-${p.id}`} data-post-row={p.id} className={selected ? "selected-row" : ""}>
          {checkbox}
          <td>{prettyDateShort(p.date)}</td>
          <td>{escapeHtml(p.time || "—")}</td>
          <td><span className={`status-badge status-${status}`}>{status === "posted" ? "Posted" : "Scheduled"}</span></td>
          {fieldCells}
          {metricCells}
          <td>{relativeTime(p.metricsUpdatedAt)}</td>
          <td data-row-control="true"><button type="button" className="btn-secondary" data-action="edit-post" data-id={p.id} onClick={() => onEditPost(p)}>Edit</button></td>
        </tr>
      );
    });
  }

  const emptyRow = filteredPosts.length === 0 ? <tr><td colSpan={colCount} className="empty-note">No posts match the current filters.</td></tr> : null;

  return (
    <div>
      <div className="table-toolbar">
        <div>
          <h2 className="table-title" style={{ margin: 0, fontSize: "1.35rem", letterSpacing: "-0.02em" }}>
            {currentTab !== "all" && <PlatformIcon platform={currentTab} iconOnly />}
            {title}
          </h2>
          <div style={{ color: "var(--muted)", fontSize: ".76rem", marginTop: 3 }}>
            {filteredPosts.length} matching item{filteredPosts.length !== 1 ? "s" : ""} · Click any row to view the complete post
          </div>
        </div>
        <div className="table-tabs">
          <button type="button" className={`table-tab ${currentTab === "all" ? " active" : ""}`} data-action="table-tab" data-platform="all" onClick={() => onTabChange("all")}>All Platforms</button>
          {PLATFORMS.map((p) => (
            <button key={p} type="button" className={`table-tab ${currentTab === p ? " active" : ""}`} data-action="table-tab" data-platform={p} onClick={() => onTabChange(p)}>
              <PlatformIcon platform={p} iconOnly /> {platformDataMap[p].name}
            </button>
          ))}
        </div>
      </div>

      <div className="table-filters">
        <input type="search" id="tableSearch" value={tableSearch} placeholder="Search posts, topics, captions, titles…" aria-label="Search posts" onChange={(e) => onSearchChange(e.target.value)} />
        <select id="tableContentType" aria-label="Filter by content type" value={tableContentType} onChange={(e) => onContentTypeChange(e.target.value)}>
          {tableTypeOptions(sourceForTypes)}
        </select>
        <select id="tableStatus" aria-label="Filter by status" value={tableStatus} onChange={(e) => onStatusChange(e.target.value)}>
          <option value="all" selected={tableStatus === "all"}>All statuses</option>
          <option value="posted" selected={tableStatus === "posted"}>Posted</option>
          <option value="scheduled" selected={tableStatus === "scheduled"}>Scheduled</option>
        </select>
        <select id="tableSort" aria-label="Sort posts" value={tableSort} onChange={(e) => onSortChange(e.target.value)}>
          <option value="date" selected={tableSort === "date"}>Sort: Date</option>
          <option value="views" selected={tableSort === "views"}>Sort: Views</option>
          <option value="likes" selected={tableSort === "likes"}>Sort: Likes</option>
          <option value="comments" selected={tableSort === "comments"}>Sort: Comments</option>
          <option value="platform" selected={tableSort === "platform"}>Sort: Platform</option>
          <option value="contentType" selected={tableSort === "contentType"}>Sort: Content type</option>
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
              {selectionMode && <th style={{ width: 38 }}></th>}
              {currentTab === "all" && <th>Platform</th>}
              <th>Date</th>
              <th>Time</th>
              <th>Status</th>
              {headFields}
              {headMetrics}
              <th>Metrics updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {currentTab === "all" ? renderAllRows() : renderPlatformRows()}
            {emptyRow}
          </tbody>
        </table>
      </div>
    </div>
  );
};
