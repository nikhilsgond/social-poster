// src/App.tsx
// Main application orchestrator.
// Uses PostContext for centralized post state.
// Persists to Supabase via the repository layer.

import { useState, useEffect, useCallback } from "react";
import { PostProvider, usePostContext } from "./context/PostContext";
import { useToast, ToastProvider } from "./components/common/Toast";
import { PlatformIcon, platformDataMap } from "./components/common/PlatformIcon";
import { Calendar } from "./components/Calendar/Calendar";
import type { CalendarMonthSyncState, CalendarPlatformSyncState, CalendarSyncPreset } from "./components/Calendar/Calendar";
import { Tables, getFilteredSortedPosts } from "./components/Tables/Tables";
import { Metrics } from "./components/Metrics/Metrics";
import { CreatePostWorkflow } from "./components/CreatePost/CreatePostWorkflow";
import { StrategyWorkflow } from "./components/CreatePost/StrategyWorkflow";
import { BulkImportModal } from "./components/BulkImport/BulkImportModal";
import { ReuseSchedulerModal } from "./components/ReuseScheduler/ReuseSchedulerModal";
import { CONTENT_TYPES, isPublishingPlatform } from "./lib/contentTypes";
import type { Platform, Post, PostStatus, MetricSnapshot, DateRange, DateRangeType } from "./types/post";
import { useDateRange, useSnapshots, useEnrichedPosts } from "./hooks/usePosts";
import { formatTimestamp, snapshotTrendData, metricNumber, formatMetric, escapeHtml } from "./lib/metrics";
import type { SnapshotSummary, SnapshotPlatformStat, TrendData } from "./lib/metrics";
import { syncMetrics } from "./lib/backend";
import type { MetricsSyncPlatform } from "./lib/backend";
import "./index.css";

type View = "calendar" | "tables" | "metrics";

const PLATFORMS: Platform[] = ["yt", "ig", "fb", "th", "li", "x"];
const METRICS_SYNC_PLATFORMS: MetricsSyncPlatform[] = ["ig", "th", "fb", "yt"];
const DEFAULT_MONTH = { year: new Date().getFullYear(), month: new Date().getMonth() };

// ── URL State Helpers ──
function loadUrlState(): Partial<{
  view: View; year: number; month: number; tableTab: string; tableSearch: string;
  tableContentType: string; tableStatus: string; tableSort: string; tableSortDir: string;
  tablePage: number;
  metricsTab: string; analysisMetric: string; analysisDimension: string; editPostId: string;
  dateRange: string; customStart: string; customEnd: string;
}> {
  try {
    const params = new URLSearchParams(window.location.search);
    return {
      view: (params.get("view") as View) || "calendar",
      year: Number(params.get("year")) || DEFAULT_MONTH.year,
      month: Number(params.get("month")) || DEFAULT_MONTH.month,
      tableTab: params.get("tab") || "all",
      tableSearch: params.get("search") || "",
      tableContentType: params.get("type") || "all",
      tableStatus: params.get("status") || "all",
      tableSort: params.get("sort") || "date",
      tableSortDir: params.get("dir") || "asc",
      tablePage: Number(params.get("page")) || 1,
      metricsTab: params.get("metrics") || "all",
      analysisMetric: params.get("metric") || "views",
      analysisDimension: params.get("dimension") || "contentType",
      editPostId: params.get("edit") || "",
      dateRange: params.get("range") || "30d",
      customStart: params.get("start") || "",
      customEnd: params.get("end") || "",
    };
  } catch { return {}; }
}

function syncUrlState(state: Record<string, string | number | boolean | undefined>) {
  const params = new URLSearchParams();
  Object.entries(state).forEach(([key, val]) => {
    if (val !== undefined && val !== "" && val !== false && val !== "all" && key !== "editPostId") {
      params.set(key, String(val));
    }
  });
  const view = state.view as string || "calendar";
  params.set("view", view);
  if (state.year) params.set("year", String(state.year));
  if (state.month !== undefined) params.set("month", String(state.month));
  if (state.tablePage) params.set("page", String(state.tablePage));
  if (state.dateRange) params.set("range", String(state.dateRange));
  if (state.customStart) params.set("start", String(state.customStart));
  if (state.customEnd) params.set("end", String(state.customEnd));
  const search = params.toString();
  const newUrl = search ? `${window.location.pathname}?${search}` : window.location.pathname;
  window.history.replaceState(null, "", newUrl);
}

// ── Main App Content ──
function AppContent() {
  const { showToast } = useToast();
  const { state, dispatch, addPost, addPostDetailed, updatePost, deletePost, movePost, refreshPosts, undo, redo, canUndo, canRedo, setEditPost } = usePostContext();
  const { posts, selectedPosts, editPostId, loading, error } = state;

  // ── View state ──
  const [view, setView] = useState<View>(() => loadUrlState().view || "calendar");

  // ── Calendar state ──
  const [currentMonth, setCurrentMonth] = useState<{ year: number; month: number }>(() => {
    const url = loadUrlState();
    return { year: url.year || DEFAULT_MONTH.year, month: url.month ?? DEFAULT_MONTH.month };
  });

  // ── Table filter state ──
  const [tableTab, setTableTab] = useState<Platform | "all">(() => (loadUrlState().tableTab as Platform | "all") || "all");
  const [tableSearch, setTableSearch] = useState(() => loadUrlState().tableSearch || "");
  const [tableContentType, setTableContentType] = useState(() => loadUrlState().tableContentType || "all");
  const [tableStatus, setTableStatus] = useState(() => loadUrlState().tableStatus || "all");
  const [tableSort, setTableSort] = useState(() => loadUrlState().tableSort || "date");
  const [tableSortDir, setTableSortDir] = useState(() => loadUrlState().tableSortDir || "asc");

  // ── Metrics state ──
  const [metricsTab, setMetricsTab] = useState<Platform | "all">(() => (loadUrlState().metricsTab as Platform | "all") || "all");
  const [analysisMetric, setAnalysisMetric] = useState(() => loadUrlState().analysisMetric || "views");
  const [analysisDimension, setAnalysisDimension] = useState(() => loadUrlState().analysisDimension || "contentType");

  // ── Analytics Date Range state ──
  const urlState = loadUrlState();
  const initialRangeType = (urlState.dateRange as DateRangeType) || "30d";
  const { type: dateRangeType, setType: setDateRangeType, customStart, customEnd, setCustomStart, setCustomEnd, range: dateRange } = useDateRange(initialRangeType);
  // Sync customStart/customEnd from URL if present
  useEffect(() => {
    if (urlState.customStart) setCustomStart(urlState.customStart);
    if (urlState.customEnd) setCustomEnd(urlState.customEnd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ── Analytics snapshots ──
  const { snapshots, loading: snapshotLoading, error: snapshotError, latestMap, reload: reloadSnapshots } = useSnapshots(dateRange);
  // Enrich posts with latest snapshot data (e.g. shares)
  const { posts: enrichedPosts } = useEnrichedPosts(snapshots);
  const [monthSync, setMonthSync] = useState<CalendarMonthSyncState>({
    running: false,
    monthLabel: "",
    results: {},
  });

  const handleSync = useCallback(async (preset: CalendarSyncPreset) => {
    if (monthSync.running) return;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const start = preset === "today"
      ? today
      : preset === "7d"
        ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
        : new Date(today.getFullYear(), today.getMonth(), 1);
    if (preset === "month") end.setFullYear(today.getFullYear(), today.getMonth() + 1, 1);
    const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    const startDate = localDate(start);
    const endDateExclusive = localDate(end);
    const monthLabel = preset === "today" ? "Today" : preset === "7d" ? "Last 7 Days" : new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(start);
    const pendingResults = Object.fromEntries(METRICS_SYNC_PLATFORMS.map((platform) => [
      platform,
      { status: "pending", discovered: 0, added: 0, existing: 0, processed: 0, failed: 0, snapshotFailures: 0 } satisfies CalendarPlatformSyncState,
    ])) as Record<MetricsSyncPlatform, CalendarPlatformSyncState>;
    const completedResults: Partial<Record<MetricsSyncPlatform, CalendarPlatformSyncState>> = {};
    setMonthSync({ running: true, monthLabel, results: pendingResults });

    for (const platform of METRICS_SYNC_PLATFORMS) {
      setMonthSync((current) => ({
        ...current,
        results: { ...current.results, [platform]: { ...current.results[platform]!, status: "running" } },
      }));
      try {
        const report = await syncMetrics({ startDate, endDateExclusive, startTime: start.toISOString(), endTimeExclusive: end.toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, platform });
        const result = report.platforms[platform];
        const discovered = result?.discovered ?? report.summary.discovered;
        const failed = result?.failed ?? report.summary.failed;
        const processed = (result?.updated ?? report.summary.updated) + failed;
        const hasErrors = Boolean(result?.errors.length || report.errors.length || report.success === false);
        const status: CalendarPlatformSyncState["status"] = result?.unavailable
          ? "unavailable"
          : failed === 0 && !hasErrors
            ? "succeeded"
            : (result?.updated ?? report.summary.updated) > 0
              ? "partial"
              : "failed";
        const platformState: CalendarPlatformSyncState = {
          status,
          discovered,
          added: result?.added ?? report.summary.added,
          existing: result?.existing ?? report.summary.existing,
          processed,
          failed,
          snapshotFailures: result?.snapshotFailures ?? report.summary.snapshotFailures,
          message: result?.errors[0] || report.errors[0],
        };
        completedResults[platform] = platformState;
        setMonthSync((current) => ({
          ...current,
          results: {
            ...current.results,
            [platform]: platformState,
          },
        }));
      } catch (err: any) {
        const platformState: CalendarPlatformSyncState = {
          status: "failed",
          discovered: 0,
          added: 0,
          existing: 0,
          processed: 0,
          failed: 0,
          snapshotFailures: 0,
          message: err?.message || "Metrics sync failed.",
        };
        completedResults[platform] = platformState;
        setMonthSync((current) => ({
          ...current,
          results: {
            ...current.results,
            [platform]: platformState,
          },
        }));
      }
    }

    const refreshResults = await Promise.allSettled([refreshPosts(), reloadSnapshots()]);
    setMonthSync((current) => ({ ...current, running: false }));
    const refreshFailed = refreshResults.some((result) => result.status === "rejected");
    const completed = Object.values(completedResults);
    const successfulPlatforms = completed.filter((result) => result.status === "succeeded").length;
    const attentionPlatforms = completed.length - successfulPlatforms;
    showToast(
      refreshFailed || attentionPlatforms > 0 ? "Sync completed with details" : "Sync complete",
      refreshFailed
        ? `${monthLabel} was synchronized, but some refreshed data could not be loaded.`
        : attentionPlatforms > 0
          ? `${successfulPlatforms} succeeded; ${attentionPlatforms} need attention. Review the platform results.`
          : `${monthLabel} metrics were synchronized across all supported platforms.`,
      refreshFailed || attentionPlatforms > 0 ? "warning" : "success",
    );
  }, [monthSync.running, refreshPosts, reloadSnapshots, showToast]);

  // ── Table pagination state ──
  const [tablePageSize] = useState(15);
  const [tablePage, setTablePage] = useState(() => {
    const url = loadUrlState();
    return Number(url.tablePage) || 1;
  });
  const [focusedTablePostId, setFocusedTablePostId] = useState<string | null>(null);

  // ── Selection state ──
  const [selectionMode, setSelectionMode] = useState(false);

  // ── Modal state ──
  const [modalOpen, setModalOpen] = useState(false);
  const [modalPreset, setModalPreset] = useState<{ date?: string; platform?: Platform } | null>(null);
  const [modalPlatform, setModalPlatform] = useState<Platform>("yt");
  const [modalDate, setModalDate] = useState("");
  const [modalTime, setModalTime] = useState("");
  const [modalContentType, setModalContentType] = useState("");
  const [modalTitle, setModalTitle] = useState("");
  const [modalTopic, setModalTopic] = useState("");
  const [modalContent, setModalContent] = useState("");
  const [modalDescription, setModalDescription] = useState("");
  const [modalCaption, setModalCaption] = useState("");
  const [modalMediaUrl, setModalMediaUrl] = useState("");
  const [modalStatus, setModalStatus] = useState<PostStatus>("scheduled");
  const [createProcessing, setCreateProcessing] = useState(false);
  const [createMode, setCreateMode] = useState<"single" | "json" | "strategy">("single");

  // ── Modal analytics toggle ──
  const [showAnalytics, setShowAnalytics] = useState(false);

  // ── Phase 5 reuse scheduler ──
  const [reuseOpen, setReuseOpen] = useState(false);
  const [reuseSource, setReuseSource] = useState<Post | null>(null);

  // ── URL sync ──
  const syncUrl = useCallback(() => {
    syncUrlState({
      view, year: currentMonth.year, month: currentMonth.month,
      tableTab, tableSearch, tableContentType, tableStatus, tableSort, tableSortDir, tablePage,
      metricsTab, analysisMetric, analysisDimension, selectionMode: selectionMode || undefined,
      dateRange: dateRangeType,
      customStart: dateRangeType === "custom" && customStart ? customStart : undefined,
      customEnd: dateRangeType === "custom" && customEnd ? customEnd : undefined,
    });
  }, [view, currentMonth, tableTab, tableSearch, tableContentType, tableStatus, tableSort, tableSortDir, tablePage, metricsTab, analysisMetric, analysisDimension, selectionMode, dateRangeType, customStart, customEnd]);

  useEffect(() => { syncUrl(); }, [syncUrl]);

  useEffect(() => {
    const urlState = loadUrlState();
    if (urlState.view) setView(urlState.view as View);
    if (urlState.year) setCurrentMonth((prev) => ({ ...prev, year: urlState.year! }));
    if (urlState.month !== undefined) setCurrentMonth((prev) => ({ ...prev, month: urlState.month! }));
    if (urlState.tableTab) setTableTab(urlState.tableTab as Platform | "all");
    if (urlState.tableSearch !== undefined) setTableSearch(urlState.tableSearch);
    if (urlState.tableContentType) setTableContentType(urlState.tableContentType);
    if (urlState.tableStatus) setTableStatus(urlState.tableStatus);
    if (urlState.tableSort) setTableSort(urlState.tableSort);
    if (urlState.tableSortDir) setTableSortDir(urlState.tableSortDir);
    if (urlState.tablePage) setTablePage(urlState.tablePage);
    if (urlState.metricsTab) setMetricsTab(urlState.metricsTab as Platform | "all");
    if (urlState.analysisMetric) setAnalysisMetric(urlState.analysisMetric);
    if (urlState.analysisDimension) setAnalysisDimension(urlState.analysisDimension);
    if (urlState.dateRange) setDateRangeType(urlState.dateRange as DateRangeType);
    if (urlState.customStart) setCustomStart(urlState.customStart);
    if (urlState.customEnd) setCustomEnd(urlState.customEnd);
    if (urlState.editPostId) {
      const post = posts.find((p) => p.id === urlState.editPostId);
      if (post) openEditModal(post);
    }
  }, []);

  // ── Boot animation ──
  const [bootLoaded, setBootLoaded] = useState(false);
  useEffect(() => { const timer = setTimeout(() => setBootLoaded(true), 600); return () => clearTimeout(timer); }, []);

  // ── Helpers ──
  const toast = useCallback((title: string, message: string, type: "success" | "error" | "info" | "warning" = "info") => {
    showToast(title, message, type);
  }, [showToast]);

  // ── Open Add Post Modal ──
  const openAddModal = useCallback((preset?: { date?: string; platform?: Platform }) => {
    setModalOpen(true);
    setCreateMode("single");
    setModalPreset(preset || null);
    setEditPost(null);
    setModalPlatform(preset?.platform || "yt");
    setModalDate(preset?.date || new Date().toISOString().slice(0, 10));
    setModalTime("");
    setModalContentType("");
    setModalTitle("");
    setModalTopic("");
    setModalContent("");
    setModalDescription("");
    setModalCaption("");
    setModalMediaUrl("");
    setModalStatus("scheduled");
    setCreateProcessing(false);
  }, []);

  // ── Open Edit Modal ──
  const openEditModal = useCallback((post: Post) => {
    setModalOpen(true);
    setModalPreset(null);
    setEditPost(post.id);
    setShowAnalytics(false);
    setModalPlatform(post.platform);
    setModalDate(post.date);
    setModalTime(post.time);
    setModalContentType(post.contentType || "");
    setModalTitle(post.title || "");
    setModalTopic(post.topic || "");
    setModalContent(post.content || "");
    setModalDescription(post.description || "");
    setModalCaption(post.caption || "");
    setModalMediaUrl(post.mediaUrl || "");
    setModalStatus(post.status);
  }, []);

  const openReuseScheduler = useCallback((post: Post | null = null) => {
    setModalOpen(false);
    setEditPost(null);
    setReuseSource(post);
    setReuseOpen(true);
  }, []);

  const closeReuseScheduler = useCallback(() => {
    setReuseOpen(false);
    setReuseSource(null);
  }, []);

  // ── Close Modal ──
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setSelectionMode(false);
    setEditPost(null);
    setShowAnalytics(false);
    setCreateProcessing(false);
  }, []);

  // ── Save Post (Add or Edit) ──
  const savePost = useCallback(async () => {
    if (!modalPlatform || !modalDate) {
      toast("Missing fields", "Platform and date are required.", "warning");
      return;
    }

    if (editPostId) {
      const changes: Partial<Post> = {
        platform: modalPlatform,
        contentType: modalContentType,
        title: modalTitle || undefined,
        topic: modalTopic || undefined,
        content: modalContent || undefined,
        description: modalDescription || undefined,
        caption: modalCaption || undefined,
        date: modalDate,
        time: modalTime,
        mediaUrl: modalMediaUrl || null,
        status: modalStatus,
      };
      await updatePost(editPostId, changes);
    } else {
      const newPost: Omit<Post, "id" | "createdAt" | "updatedAt"> = {
        platform: modalPlatform,
        contentType: modalContentType,
        title: modalTitle || undefined,
        topic: modalTopic || undefined,
        content: modalContent || undefined,
        description: modalDescription || undefined,
        caption: modalCaption || undefined,
        date: modalDate,
        time: modalTime,
        mediaUrl: modalMediaUrl || null,
        status: modalStatus,
      };
      await addPost(newPost);
    }
    closeModal();
  }, [editPostId, modalPlatform, modalDate, modalTime, modalContentType, modalTitle, modalTopic, modalContent, modalDescription, modalCaption, modalMediaUrl, modalStatus, addPost, updatePost, closeModal, toast]);

  // ── Delete Post ──
  const deletePostFn = useCallback(async (id: string) => {
    const post = posts.find((p) => p.id === id);
    await deletePost(id);
    setSelectionMode(false);
    toast("Post deleted", `Post by ${platformDataMap[post?.platform || "yt"].name} removed.`, "info");
  }, [posts, deletePost, toast]);

  // ── Bulk Delete ──
  const bulkDelete = useCallback(async () => {
    const ids = Object.keys(selectedPosts).filter((id) => selectedPosts[id]);
    if (!ids.length) return;
    for (const id of ids) await deletePost(id);
    setSelectionMode(false);
    toast("Posts deleted", `${ids.length} post(s) deleted.`, "info");
  }, [selectedPosts, deletePost, toast]);

  // ── Toggle Select ──
  const toggleSelect = useCallback((id: string) => {
    dispatch({ type: "SELECT_TOGGLE", payload: id });
  }, [dispatch]);

  // ── Enter/Exit Delete Mode ──
  const enterDeleteMode = useCallback(() => { setSelectionMode(true); }, []);
  const exitDeleteMode = useCallback(() => { setSelectionMode(false); }, []);

  // ── Clear Filters ──
  const clearFilters = useCallback(() => {
    setTableSearch(""); setTableContentType("all"); setTableStatus("all");
    setTableSort("date"); setTableSortDir("asc");
    setTablePage(1);
  }, []);

  // ── Month Navigation ──
  const navMonth = useCallback((delta: number) => {
    setCurrentMonth((prev) => {
      const m = prev.month + delta;
      const y = prev.year + Math.floor(m / 12);
      const mo = ((m % 12) + 12) % 12;
      return { year: y, month: mo };
    });
  }, []);

  const goToday = useCallback(() => {
    setCurrentMonth({ year: new Date().getFullYear(), month: new Date().getMonth() });
  }, []);

  // ── View switching ──
  const switchView = useCallback((v: View) => { setView(v); }, []);

  // ── Jump to Table from Calendar ──
  const jumpToTable = useCallback((postId: string, platform: Platform) => {
    const target = posts.find((post) => post.id === postId);
    if (!target) return;

    const targetPlatform = target.platform || platform;
    const tablePosts = getFilteredSortedPosts(posts, {
      currentTab: targetPlatform,
      tableSearch: "",
      tableContentType: "all",
      tableStatus: "all",
      tableSort,
      tableSortDir,
    });
    const postIndex = tablePosts.findIndex((post) => post.id === postId);
    const targetPage = postIndex >= 0 ? Math.floor(postIndex / tablePageSize) + 1 : 1;

    setTableTab(targetPlatform);
    setTableSearch("");
    setTableContentType("all");
    setTableStatus("all");
    setTablePage(targetPage);
    setFocusedTablePostId(postId);
    setView("tables");
  }, [posts, tableSort, tableSortDir, tablePageSize]);

  useEffect(() => {
    if (!focusedTablePostId) return;
    const timer = window.setTimeout(() => setFocusedTablePostId(null), 2400);
    return () => window.clearTimeout(timer);
  }, [focusedTablePostId]);

  // ── View Post from Calendar (opens edit modal) ──
  const onViewPost = useCallback((post: Post) => {
    openEditModal(post);
  }, [openEditModal]);

  // ── Drop on Calendar (drag) ──
  const handleCalendarMove = useCallback(async (postId: string, newDate: string) => {
    await movePost(postId, newDate);
    toast("Post moved", `Post moved to ${newDate}.`, "success");
  }, [movePost, toast]);

  // ── Export ──
  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify(posts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "social-planner-export.json"; a.click();
    URL.revokeObjectURL(url);
    toast("Exported", "JSON export downloaded.", "success");
  }, [posts, toast]);

  const exportCSV = useCallback(() => {
    if (!posts.length) { toast("Nothing to export", "No posts to export.", "info"); return; }
    const headers = ["Date", "Time", "Platform", "Content Type", "Title", "Topic", "Content", "Status", "Views", "Likes", "Comments"];
    const rows = posts.map((p) => [p.date, p.time, platformDataMap[p.platform].name, p.contentType || "", p.title || "", p.topic || "", (p.content || p.caption || "").replace(/,/g, " "), p.status, p.views || 0, p.likes || 0, p.comments || 0]);
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "social-planner-export.csv"; a.click();
    URL.revokeObjectURL(url);
    toast("Exported", "CSV export downloaded.", "success");
  }, [posts, toast]);

  const printTable = useCallback(() => { window.print(); }, []);

  // ── Keyboard ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isModal = modalOpen || reuseOpen;
      if (e.key === "Escape") {
        if (selectionMode) { exitDeleteMode(); }
        else if (reuseOpen) { closeReuseScheduler(); }
        else if (modalOpen && !createProcessing) { closeModal(); }
        return;
      }
      if (!isModal) {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.shiftKey && e.key === "z"))) { e.preventDefault(); redo(); return; }
        if (view === "calendar") {
          if (e.key === "ArrowLeft") { e.preventDefault(); navMonth(-1); }
          else if (e.key === "ArrowRight") { e.preventDefault(); navMonth(1); }
          else if (e.key === "Home") { e.preventDefault(); goToday(); }
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modalOpen, reuseOpen, selectionMode, view, undo, redo, navMonth, goToday, exitDeleteMode, closeModal, closeReuseScheduler, createProcessing]);

  // ── Content type options ──
  const contentTypeOptions = CONTENT_TYPES[modalPlatform] || [];

  // ── Render ──
  return (
    <div className="app">
      <div className={`app-boot${bootLoaded ? " hide" : ""}`}>
        <div className="boot-dot" />
        <span>Loading...</span>
      </div>

      {/* ── Loading State ── */}
      {loading && (
        <div className="hint-bar" style={{ textAlign: "center", padding: "40px", fontSize: "1.1rem" }}>
          Loading posts from the database...
        </div>
      )}

      {/* ── Error State ── */}
      {error && !loading && (
        <div className="hint-bar" style={{ textAlign: "center", padding: "20px", color: "var(--error)", background: "var(--panel-alt)", borderRadius: 8, margin: 16 }}>
          <strong>Connection Error:</strong> {error}
          <br />
          <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      <header className="topbar">
        <div className="brand">Social Planner</div>
        <span className="storage-status saved">
          <span className="storage-dot" />
          <span className="storage-label">Supabase</span>
        </span>
        <span className="brand-sub">Content calendar</span>

        <nav className="month-nav">
          <button type="button" onClick={() => navMonth(-1)}>Prev</button>
          <span className="month-label">
            {new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(
              new Date(currentMonth.year, currentMonth.month, 1)
            )}
          </span>
          <button type="button" onClick={goToday}>Today</button>
          <button type="button" onClick={() => navMonth(1)}>Next</button>
        </nav>

        <div className="toolbar-actions">
          <button className="btn-secondary" type="button" onClick={() => openReuseScheduler(null)}>
            Reuse &amp; Schedule
          </button>
          <button className="btn-import" type="button" onClick={() => { setEditPost(null); setModalPreset(null); setCreateMode("json"); setCreateProcessing(false); setModalOpen(true); }}>
            Bulk Import JSON
          </button>
          <button className="btn-primary" type="button" onClick={() => openAddModal()}>
            Create Post
          </button>
        </div>

        <nav className="view-nav">
          {(["calendar", "tables", "metrics"] as View[]).map((item) => (
            <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => switchView(item)}>
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      <main id="mainArea">
        <div className="view-panel">
          {/* ── Calendar View ── */}
          {view === "calendar" && !loading && (
            <>
              {posts.length === 0 && (
                <div className="hint-bar">Nothing planned yet. Click Create Post, or click any day to add one there.</div>
              )}
              <Calendar
                year={currentMonth.year}
                month={currentMonth.month}
                onAddPost={openAddModal}
                onJumpToTable={jumpToTable}
                posts={posts}
                onMovePost={handleCalendarMove}
                onSync={handleSync}
                monthSync={monthSync}
              />
            </>
          )}

          {/* ── Tables View ── */}
          {view === "tables" && !loading && (
            <Tables
              currentTab={tableTab}
              onTabChange={(tab: string) => { setTableTab(tab as any); setTablePage(1); }}
              posts={posts}
              tableSearch={tableSearch}
              onSearchChange={(val) => { setTableSearch(val); setTablePage(1); }}
              tableContentType={tableContentType}
              onContentTypeChange={(val) => { setTableContentType(val); setTablePage(1); }}
              tableStatus={tableStatus}
              onStatusChange={(val) => { setTableStatus(val); setTablePage(1); }}
              tableSort={tableSort}
              onSortChange={(val) => { setTableSort(val); setTablePage(1); }}
              tableSortDir={tableSortDir}
              onSortDirChange={() => setTableSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              selectionMode={selectionMode}
              onEnterDeleteMode={enterDeleteMode}
              onExitDeleteMode={exitDeleteMode}
              onDeleteSelected={bulkDelete}
              onExportJSON={exportJSON}
              onExportCSV={exportCSV}
              onPrint={printTable}
              onEditPost={openEditModal}
              onViewPost={onViewPost}
              onDeletePost={deletePostFn}
              onReusePost={openReuseScheduler}
              onClearFilters={clearFilters}
              selectedPosts={selectedPosts}
              onToggleSelect={toggleSelect}
              pageSize={tablePageSize}
              currentPage={tablePage}
              onPageChange={setTablePage}
              focusPostId={focusedTablePostId}
            />
          )}

          {/* ── Metrics View ── */}
          {view === "metrics" && !loading && (
            <Metrics
              metricsTab={metricsTab}
              onTabChange={(tab: string) => setMetricsTab(tab as any)}
              posts={enrichedPosts}
              analysisMetric={analysisMetric}
              onAnalysisMetricChange={setAnalysisMetric}
              analysisDimension={analysisDimension}
              onAnalysisDimensionChange={setAnalysisDimension}
              // Date range props
              dateRange={dateRange}
              dateRangeType={dateRangeType}
              onDateRangeTypeChange={setDateRangeType}
              customStartDate={customStart}
              customEndDate={customEnd}
              onCustomStartDateChange={setCustomStart}
              onCustomEndDateChange={setCustomEnd}
              // Snapshot props
              snapshots={snapshots}
              snapshotLoading={snapshotLoading}
              snapshotError={snapshotError}

            />
          )}
        </div>
      </main>

      {/* ── Add/Edit Post Modal ── */}
      {modalOpen && !editPostId && createMode === "single" && (
        <CreatePostWorkflow
          posts={posts}
          initialDate={modalPreset?.date}
          initialPlatform={modalPreset?.platform && isPublishingPlatform(modalPreset.platform) ? modalPreset.platform : undefined}
          onCreate={addPostDetailed}
          onClose={closeModal}
          onProcessingChange={setCreateProcessing}
          onModeChange={setCreateMode}
        />
      )}
      {modalOpen && !editPostId && createMode === "json" && (
        <BulkImportModal
          posts={posts}
          onCreate={addPostDetailed}
          onClose={closeModal}
          onModeChange={setCreateMode}
          onProcessingChange={setCreateProcessing}
        />
      )}
      {modalOpen && !editPostId && createMode === "strategy" && (
        <StrategyWorkflow
          posts={posts}
          onCreate={addPostDetailed}
          onClose={closeModal}
          onModeChange={setCreateMode}
          onProcessingChange={setCreateProcessing}
        />
      )}
      {modalOpen && editPostId && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="panel">
            <h3>{editPostId ? "Edit Post" : "Add Post"}</h3>
            <p className="sub">{editPostId ? "Update the details for your scheduled post." : "Schedule a new post for your content calendar."}</p>

            <label>Platform</label>
            <div className="platform-picker">
              {PLATFORMS.map((p) => (
                <button key={p} type="button" className={`platform-pick-btn${modalPlatform === p ? " active" : ""}`} onClick={() => { setModalPlatform(p); setModalContentType(""); }}>
                  <PlatformIcon platform={p} iconOnly /> {platformDataMap[p].name}
                </button>
              ))}
            </div>

            <label>Date</label>
            <input type="date" value={modalDate} onChange={(e) => setModalDate(e.target.value)} />
            <label>Time</label>
            <input type="time" value={modalTime} onChange={(e) => setModalTime(e.target.value)} />
            <label>Content Type</label>
            <select value={modalContentType} onChange={(e) => setModalContentType(e.target.value)}>
              <option value="">Select type...</option>
              {contentTypeOptions.map((ct) => <option key={ct} value={ct}>{ct}</option>)}
            </select>

            {modalPlatform === "yt" && (
              <>
                <label>Title</label>
                <input type="text" value={modalTitle} onChange={(e) => setModalTitle(e.target.value)} placeholder="Video title..." />
                <label>Description</label>
                <textarea value={modalDescription} onChange={(e) => setModalDescription(e.target.value)} placeholder="Video description..." />
              </>
            )}
            {modalPlatform === "ig" && (
              <>
                <label>Topic name</label>
                <input type="text" value={modalTopic} onChange={(e) => setModalTopic(e.target.value)} placeholder="Topic..." />
                <label>Caption</label>
                <textarea value={modalCaption} onChange={(e) => setModalCaption(e.target.value)} placeholder="Caption..." />
              </>
            )}
            {(modalPlatform === "fb" || modalPlatform === "th" || modalPlatform === "x") && (
              <>
                <label>Topic name</label>
                <input type="text" value={modalTopic} onChange={(e) => setModalTopic(e.target.value)} placeholder="Topic..." />
                <label>Content</label>
                <textarea value={modalContent} onChange={(e) => setModalContent(e.target.value)} placeholder="Content..." />
              </>
            )}
            {modalPlatform === "li" && (
              <>
                <label>Topic name</label>
                <input type="text" value={modalTopic} onChange={(e) => setModalTopic(e.target.value)} placeholder="Topic..." />
                <label>Content</label>
                <textarea value={modalContent} onChange={(e) => setModalContent(e.target.value)} placeholder="Content..." />
              </>
            )}

            <label>Media URL</label>
            <input type="text" value={modalMediaUrl} onChange={(e) => setModalMediaUrl(e.target.value)} placeholder="https://..." />

            <label>Status</label>
            <select value={modalStatus} onChange={(e) => setModalStatus(e.target.value as PostStatus)}>
              <option value="scheduled">Scheduled</option>
              <option value="publishing">Publishing</option>
              <option value="published">Published</option>
              <option value="draft">Draft</option>
              <option value="failed">Failed</option>
            </select>

            {/* ── Post Analytics (edit mode only) ── */}
            {editPostId && (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-mini"
                  style={{ marginTop: 8 }}
                  onClick={() => setShowAnalytics(!showAnalytics)}
                >
                  {showAnalytics ? "▼ Hide analytics" : "▶ Show analytics"}
                </button>
                {showAnalytics && (() => {
                  const post = posts.find((p) => p.id === editPostId);
                  if (!post) return null;
                  const latestSnap = latestMap.get(post.id);
                  const postSnapshots = snapshots.filter((s) => s.postId === post.id);
                  const trend = snapshotTrendData(postSnapshots, "views");
                  const platformMetrics = latestSnap?.platformMetrics || {};
                  const pmEntries = Object.entries(platformMetrics);
                  return (
                    <div className="post-analytics" style={{ marginTop: 12 }}>
                      <h4 style={{ margin: "0 0 8px", fontSize: ".78rem", fontWeight: 700 }}>Performance Analytics</h4>

                      {/* Current metrics */}
                      <div className="detail-item">
                        <div className="detail-item-head"><span>Current metrics</span></div>
                        <div className="detail-fields">
                          <div className="detail-field"><b>Views:</b> {formatMetric(metricNumber(post, "views"))}</div>
                          <div className="detail-field"><b>Likes:</b> {formatMetric(metricNumber(post, "likes"))}</div>
                          <div className="detail-field"><b>Comments:</b> {formatMetric(metricNumber(post, "comments"))}</div>
                          <div className="detail-field"><b>Shares:</b> {latestSnap ? formatMetric(latestSnap.shares) : "—"}</div>
                          <div className="detail-field"><b>Last updated:</b> {formatTimestamp(post.metricsUpdatedAt)}</div>
                        </div>
                      </div>

                      {/* Platform-specific metrics */}
                      {pmEntries.length > 0 && (
                        <div className="detail-item">
                          <div className="detail-item-head"><span>Platform-specific metrics</span></div>
                          <div className="detail-fields">
                            {pmEntries.slice(0, 8).map(([k, v]) => (
                              <div key={k} className="detail-field"><b>{escapeHtml(k)}:</b> {typeof v === "number" ? v.toLocaleString() : escapeHtml(String(v))}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Historical snapshots table */}
                      <div className="detail-item">
                        <div className="detail-item-head"><span>Snapshot history ({postSnapshots.length} captures)</span></div>
                        {postSnapshots.length > 0 ? (
                          <table className="analysis-table" style={{ fontSize: ".68rem" }}>
                            <thead>
                              <tr><th>Captured</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th></tr>
                            </thead>
                            <tbody>
                              {postSnapshots.map((s) => (
                                <tr key={s.id}>
                                  <td>{escapeHtml(formatTimestamp(s.capturedAt))}</td>
                                  <td className="num">{s.views}</td>
                                  <td className="num">{s.likes}</td>
                                  <td className="num">{s.comments}</td>
                                  <td className="num">{s.shares}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <div className="empty-metrics" style={{ padding: "16px 10px" }}>No snapshot data yet. Run a metrics sync to populate.</div>
                        )}
                      </div>
                    </div>
                  );
                })()}
              </>
            )}

            <div className="panel-actions">
              <div className="left">
                {editPostId && (
                  <>
                    <button type="button" className="btn-danger btn-mini" onClick={() => { deletePostFn(editPostId); }}>Delete</button>
                    <button type="button" className="btn-secondary btn-mini" onClick={() => {
                      const source = posts.find((post) => post.id === editPostId);
                      if (source) openReuseScheduler(source);
                    }}>Reuse</button>
                  </>
                )}
              </div>
              <div className="right">
                <button type="button" className="btn-secondary" onClick={closeModal}>Cancel</button>
                <button type="button" className="btn-primary" onClick={savePost} disabled={!modalPlatform || !modalDate}>
                  {editPostId ? "Update" : "Add"} Post
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {reuseOpen && <ReuseSchedulerModal sourcePost={reuseSource} onClose={closeReuseScheduler} />}

      <div className="toast-stack" aria-live="polite" />
    </div>
  );
}

// ── Root App ──
export default function App() {
  return (
    <ToastProvider>
      <PostProvider>
        <AppContent />
      </PostProvider>
    </ToastProvider>
  );
}
