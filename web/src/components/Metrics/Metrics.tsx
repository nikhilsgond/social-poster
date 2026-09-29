// src/components/Metrics/Metrics.tsx
// Phase 3 Analytics Dashboard — extends the existing Metrics component.
// Reuses the existing design system: dark theme cards, platform icons, bar charts, donut charts.
// Adds: date range filtering, snapshot-based historical trends, shares KPI,
// multi-metric top posts, individual post analytics.

import React from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import type { Post, Platform, MetricSnapshot, DateRange, DateRangeType } from "../../types/post";
import {
  metricSummary, metricNumber, formatMetric, escapeHtml, prettyDateShort, relativeTime,
  filterPostsByDateRange, snapshotSummary as getSnapshotSummary, latestSnapshotsByPost,
  snapshotTrendData, snapshotPlatformStats as getSnapshotPlatformStats, latestSnapshot, formatTimestamp,
  DATE_RANGE_OPTIONS, METRIC_OPTIONS,
} from "../../lib/metrics";
import type { SnapshotSummary, SnapshotPlatformStat, TrendData } from "../../lib/metrics";

const PLATFORMS = ["yt", "ig", "fb", "th", "li", "x"] as Platform[];

// ── SVG Line Trend Chart ──
function LineTrendChart({ dates, values, title, subtitle, metricLabel }: {
  dates: string[]; values: number[]; title: string; subtitle: string; metricLabel: string;
}) {
  if (!dates.length) return (
    <div className="chart-card">
      <h3>{escapeHtml(title)}</h3>
      <div className="chart-subtitle">{escapeHtml(subtitle)}</div>
      <div className="empty-metrics">No {escapeHtml(metricLabel)} data yet in this range.</div>
    </div>
  );
  const max = Math.max(1, Math.max.apply(null, values));
  const W = 760, H = 220, L = 34, R = 16, T = 18, B = 40;
  const innerW = W - L - R, innerH = H - T - B;
  const points = values.map((v, i) => {
    const x = L + (dates.length === 1 ? innerW / 2 : i * (innerW / (dates.length - 1)));
    const y = T + innerH - (v / max * innerH);
    return [x, y];
  });
  const poly = points.map((pt) => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");
  const grids = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const y = T + innerH * r;
    return <line key={r} x1={L} x2={W - R} y1={y} y2={y} className="trend-grid" />;
  });
  const labels: React.ReactNode[] = [];
  [0, Math.floor((dates.length - 1) / 2), dates.length - 1].forEach((i) => {
    if (i < 0 || i >= dates.length || labels.some((l) => l && (l as any).key === i)) return;
    const pt = points[i];
    labels.push(<text key={i} x={pt[0]} y={H - 9} textAnchor="middle" className="trend-label">{escapeHtml(prettyDateShort(dates[i]))}</text>);
  });
  const dots = points.map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r="3" className="trend-dot" />);
  const yAxis = [0, 0.25, 0.5, 0.75, 1].map((r) => {
    const y = T + innerH * r;
    const val = max * (1 - r);
    return <text key={r} x={L - 6} y={y + 4} textAnchor="end" className="trend-label" style={{ fontSize: 9 }}>{formatMetric(val)}</text>;
  });
  return (
    <div className="chart-card">
      <h3>{escapeHtml(title)}</h3>
      <div className="chart-subtitle">{escapeHtml(subtitle)} — using snapshot <code>captured_at</code></div>
      <div className="trend-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label={metricLabel + " over time"}>
          {grids}{yAxis}
          <polyline points={poly} className="trend-line" />{dots}{labels}
        </svg>
      </div>
    </div>
  );
}

// ── KPI Cards (with shares from snapshots) ──
function KPICards({ summary, snapshotSummary }: {
  summary: ReturnType<typeof metricSummary>;
  snapshotSummary: SnapshotSummary | null;
}) {
  const cards = [
    { label: "Posts", value: formatMetric(summary.count), sub: "in selected range" },
    { label: "Views", value: formatMetric(summary.views), sub: "total recorded" },
    { label: "Likes", value: formatMetric(summary.likes), sub: "total recorded" },
    { label: "Comments", value: formatMetric(summary.comments), sub: "total recorded" },
    { label: "Shares", value: formatMetric(snapshotSummary ? snapshotSummary.shares : summary.comments), sub: snapshotSummary ? "from latest snapshots" : "Not available in posts table" },
    { label: "Avg views / post", value: formatMetric(summary.avgViews), sub: "based on recorded views" },
  ];
  return (
    <div className="kpi-grid">
      {cards.map((k) => (
        <div key={k.label} className="kpi-card">
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-sub">{k.sub}</div>
        </div>
      ))}
      <div className="kpi-card">
        <div className="kpi-label">Engagement</div>
        <div className="kpi-value">{summary.engagement.toFixed(2)}%</div>
        <div className="kpi-sub">(likes + comments) / views</div>
      </div>
    </div>
  );
}

// ── Date Range Selector ──
function DateRangeSelector({ dateRangeType, onDateRangeTypeChange, customStart, customEnd, onCustomStartChange, onCustomEndChange }: {
  dateRangeType: string;
  onDateRangeTypeChange: (type: DateRangeType) => void;
  customStart: string;
  customEnd: string;
  onCustomStartChange: (val: string) => void;
  onCustomEndChange: (val: string) => void;
}) {
  return (
    <div className="date-range-selector">
      <div className="date-range-chips">
        {DATE_RANGE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`date-range-chip ${dateRangeType === opt.value ? "active" : ""}`}
            data-action="date-range"
            data-range={opt.value}
            onClick={() => onDateRangeTypeChange(opt.value as DateRangeType)}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {dateRangeType === "custom" && (
        <div className="date-range-custom">
          <input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)} />
          <span>to</span>
          <input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)} />
        </div>
      )}
    </div>
  );
}

// ── Content Type Bar Chart ──
function contentTypeChart(pool: Post[]) {
  const counts: Record<string, number> = {};
  pool.forEach((p) => { const t = p.contentType || "Other"; counts[t] = (counts[t] || 0) + 1; });
  const items = Object.keys(counts).map((k) => ({ label: k, value: counts[k] })).sort((a, b) => b.value - a.value).slice(0, 8);
  if (!items.length) return <div className="empty-metrics">No content-type data yet.</div>;
  const max = Math.max(1, Math.max.apply(null, items.map((x) => x.value)));
  return <div className="metric-chart-bars">{items.map((x) => <div key={x.label} className="metric-bar-row"><div className="metric-bar-label"><span>{escapeHtml(x.label)}</span></div><div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${x.value / max * 100}%`, background: "var(--text)" }} /></div><div className="metric-bar-value">{x.value}</div></div>)}</div>;
}

// ── Donut Chart ──
function donutChart(items: { key: string; value: number }[]) {
  const total = items.reduce((a, x) => a + x.value, 0);
  if (!total) return <div className="empty-metrics">No posts yet.</div>;
  let angle = 0; const stops: string[] = [];
  items.forEach((x) => { const p = (platformDataMap as any)[x.key as any]; const next = angle + (x.value / total * 360); stops.push(`${p.shade} ${angle}deg ${next}deg`); angle = next; });
  return <div className="donut-layout"><div className="donut" style={{ background: `conic-gradient(${stops.join(",")})` }}><div className="donut-center"><strong>{formatMetric(total)}</strong><span>posts</span></div></div><div className="donut-legend">{items.map((x) => { const p = (platformDataMap as any)[x.key as any]; return <div key={x.key} className="legend-item"><i className="legend-dot" style={{ background: p.shade }} /> <b>{escapeHtml(p.name)}</b><span>{x.value}</span></div>; })}</div></div>;
}

// ── Views Trend Chart (post dates — existing) ──
function viewsTrendChart(pool: Post[]) {
  const byDate: Record<string, number> = {};
  pool.forEach((p) => { const d = p.date; if (d && d !== "Unknown") byDate[d] = (byDate[d] || 0) + metricNumber(p, "views"); });
  const dates = Object.keys(byDate).sort();
  if (!dates.length) return <div className="empty-metrics">No dated view data yet.</div>;
  const vals = dates.map((d) => byDate[d]);
  const max = Math.max(1, Math.max.apply(null, vals));
  const W = 760, H = 220, L = 34, R = 16, T = 18, B = 30;
  const innerW = W - L - R, innerH = H - T - B;
  const points = vals.map((v, i) => { const x = L + (dates.length === 1 ? innerW / 2 : i * (innerW / (dates.length - 1))); const y = T + innerH - (v / max * innerH); return [x, y]; });
  const poly = points.map((pt) => `${pt[0].toFixed(1)},${pt[1].toFixed(1)}`).join(" ");
  const grids = [0, .5, 1].map((r) => { const y = T + innerH * r; return <line key={r} x1={L} x2={W - R} y1={y} y2={y} className="trend-grid" />; });
  let labels = "";
  [0, Math.floor((dates.length - 1) / 2), dates.length - 1].forEach((i) => { if (i < 0) return; const pt = points[i]; labels += `<text key={i} x={pt[0]} y={H - 9} textAnchor="middle" className="trend-label">${escapeHtml(prettyDateShort(dates[i]))}</text>`; });
  const dots = points.map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r="3" className="trend-dot" />);
  return <div className="trend-wrap"><svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label="Views over time">{grids}<polyline points={poly} className="trend-line" />{dots}{labels}</svg></div>;
}

// ── Weekday Chart ──
function weekdayChart(pool: Post[]) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  pool.forEach((p) => { if (!p.date) return; const a = p.date.split("-"); const d = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2])); const idx = (d.getDay() + 6) % 7; counts[idx]++; });
  const max = Math.max(1, Math.max.apply(null, counts));
  return <div className="weekday-grid">{names.map((n, i) => <div key={n} className="weekday-col"><span className="weekday-value">{counts[i]}</span><div className="weekday-track"><div className="weekday-fill" style={{ height: `${counts[i] / max * 100}%` }} /></div><span className="weekday-name">{n}</span></div>)}</div>;
}

// ── Top Posts (multi-metric sortable) ──
function topPostsHtml(pool: Post[], sortBy: string, metricOptions: { value: string; label: string }[]) {
  const list = pool.slice().sort((a, b) => metricNumber(b, sortBy) - metricNumber(a, sortBy)).slice(0, 10);
  if (!list.length) return <div className="empty-metrics">No posts available.</div>;
  return (
    <div className="top-posts">
      {list.map((p, i) => {
        const pl = (platformDataMap as any)[p.platform];
        const metricLabel = metricOptions.find((m) => m.value === sortBy)?.label || sortBy;
        return (
          <div key={p.id} className="top-post">
            <div className="top-post-rank">{i + 1}</div>
            <div className="top-post-main">
              <div className="top-post-title">{escapeHtml((p.title || p.topic || p.content || "").slice(0, 75) + ((p.title || p.topic || p.content || "").length > 75 ? "…" : ""))}</div>
              <div className="top-post-meta">
                <PlatformIcon platform={p.platform} iconOnly />
                <span>{escapeHtml((pl as any).name)}</span>
                <span>·</span>
                <span>{escapeHtml(prettyDateShort(p.date))}{p.time ? ` · ${escapeHtml(p.time)}` : ""}</span>
              </div>
            </div>
            <div className="top-post-metric">
              {formatMetric(metricNumber(p, sortBy))} {metricLabel.toLowerCase()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Metric Bar Chart ──
function metricBarChart(items: { key: string; views: number; engagement: number; posts: number; shares?: number }[], valueKey: string, percentMode: boolean) {
  const max = Math.max(1, Math.max.apply(null, items.map((x) => Number((x as any)[valueKey]) || 0)));
  return <div className="metric-chart-bars">{items.map((x) => { const v = Number((x as any)[valueKey]) || 0; const pct = (v / max) * 100; const pd = (platformDataMap as any)[x.key as any]; return <div key={x.key} className="metric-bar-row"><div className="metric-bar-label"><PlatformIcon platform={x.key as Platform} iconOnly /><span>{escapeHtml(pd.name)}</span></div><div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${Math.max(v ? 2 : 0, pct)}%`, background: pd.shade }} /></div><div className="metric-bar-value">{percentMode ? v.toFixed(2) + "%" : formatMetric(v)}</div></div>; })}</div>;
}

// ── Snapshot Table (for individual post analytics) ──
function snapshotTable(snapshots: MetricSnapshot[]) {
  if (!snapshots.length) return <div className="empty-metrics">No snapshot data for this post.</div>;
  return (
    <table className="analysis-table">
      <thead>
        <tr><th>Captured</th><th>Views</th><th>Likes</th><th>Comments</th><th>Shares</th></tr>
      </thead>
      <tbody>
        {snapshots.map((s) => (
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
  );
}

// ── Platform-Specific Metrics Summary ──
function platformMetricsSummary(latest: MetricSnapshot | null) {
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

// ── Render Overview ──
function renderMetricsOverview(
  pool: Post[],
  snapshots: MetricSnapshot[],
  snapshotSum: SnapshotSummary | null,
  snapPlatformStats: SnapshotPlatformStat[],
  trendData: { trendViews: TrendData; trendLikes: TrendData; trendComments: TrendData; trendShares: TrendData },
  topPostsMetric: string,
  onTopPostsMetricChange: (m: string) => void,
) {
  // Post-based platform stats (for donut chart, posts by platform)
  const stats = PLATFORMS.map((p) => {
    const ps = pool.filter((x) => x.platform === p);
    const s = metricSummary(ps);
    return { key: p, posts: s.count, views: s.views, likes: s.likes, comments: s.comments, shares: 0, engagement: s.engagement };
  });
  const summary = metricSummary(pool);

  return (
    <>
      <KPICards summary={summary} snapshotSummary={snapshotSum || null} />

      {/* Historical Trends from Snapshots */}
      <div className="chart-card">
        <h3>Historical metric trends</h3>
        <div className="chart-subtitle">Based on snapshot capture dates (not publication dates)</div>
        {snapshots.length === 0 ? (
          <div className="empty-metrics">No snapshot data yet. Run a metrics sync to populate historical trends.</div>
        ) : (
          <div className="metrics-grid equal">
            <div className="chart-card" style={{ background: "var(--panel-alt)" }}><h4>Views</h4>{formatMetric(trendData.trendViews.values.reduce((a, b) => a + b, 0))} total captured</div>
            <div className="chart-card" style={{ background: "var(--panel-alt)" }}><h4>Likes</h4>{formatMetric(trendData.trendLikes.values.reduce((a, b) => a + b, 0))} total captured</div>
            <div className="chart-card" style={{ background: "var(--panel-alt)" }}><h4>Comments</h4>{formatMetric(trendData.trendComments.values.reduce((a, b) => a + b, 0))} total captured</div>
            <div className="chart-card" style={{ background: "var(--panel-alt)" }}><h4>Shares</h4>{formatMetric(trendData.trendShares.values.reduce((a, b) => a + b, 0))} total captured</div>
          </div>
        )}
      </div>

      {/* Snapshot Trend Line Charts */}
      <LineTrendChart dates={trendData.trendViews.dates} values={trendData.trendViews.values} title="Views over time" subtitle="Daily total views from snapshots" metricLabel="views" />
      <LineTrendChart dates={trendData.trendLikes.dates} values={trendData.trendLikes.values} title="Likes over time" subtitle="Daily total likes from snapshots" metricLabel="likes" />
      <LineTrendChart dates={trendData.trendComments.dates} values={trendData.trendComments.values} title="Comments over time" subtitle="Daily total comments from snapshots" metricLabel="comments" />
      <LineTrendChart dates={trendData.trendShares.dates} values={trendData.trendShares.values} title="Shares over time" subtitle="Daily total shares from snapshots" metricLabel="shares" />

      {/* Platform Comparison from snapshots */}
      <div className="metrics-grid">
        <div className="chart-card"><h3>Views by platform</h3><div className="chart-subtitle">Latest snapshot totals</div>{metricBarChart(snapPlatformStats, "views", false)}</div>
        <div className="chart-card"><h3>Engagement rate</h3><div className="chart-subtitle">Likes + comments / views</div>{metricBarChart(snapPlatformStats, "engagement", true)}</div>
      </div>
      <div className="metrics-grid equal">
        <div className="chart-card"><h3>Content volume</h3><div className="chart-subtitle">Posts in selected range</div>{donutChart(stats.map(x => ({ key: x.key, value: x.posts })))}</div>
        <div className="chart-card"><h3>Shares by platform</h3><div className="chart-subtitle">Latest snapshot totals</div>{metricBarChart(snapPlatformStats, "shares", false)}</div>
      </div>

      {/* Top Posts with multi-metric sorting */}
      <div className="metrics-grid equal">
        <div className="chart-card">
          <h3>Top posts</h3>
          <div className="chart-subtitle">
            Sort by{" "}
            <select value={topPostsMetric} onChange={(e) => onTopPostsMetricChange(e.target.value)} style={{ fontSize: ".68rem", padding: "2px 6px", borderRadius: "5px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}>
              {METRIC_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </select>
          </div>
          {topPostsHtml(pool, topPostsMetric, METRIC_OPTIONS)}
        </div>
        <div className="chart-card"><h3>Publishing activity</h3><div className="chart-subtitle">Posts by day of week (publication date)</div>{weekdayChart(pool)}</div>
      </div>
    </>
  );
}

// ── Render Platform-specific Analytics ──
function renderMetricsPlatform(
  key: string,
  pool: Post[],
  snapshots: MetricSnapshot[],
  snapPlatformStats: SnapshotPlatformStat[],
  topPostsMetric: string,
  onTopPostsMetricChange: (m: string) => void,
  platformSnapshots: MetricSnapshot[],
) {
  const pl = (platformDataMap as any)[key];
  const summary = metricSummary(pool);
  const latestSnap = latestSnapshot(platformSnapshots);

  // Engagement by content type
  const engagementByType: Record<string, { views: number; likes: number; comments: number }> = {};
  pool.forEach((p) => { const t = p.contentType || "Other"; if (!engagementByType[t]) engagementByType[t] = { views: 0, likes: 0, comments: 0 }; engagementByType[t].views += metricNumber(p, "views"); engagementByType[t].likes += metricNumber(p, "likes"); engagementByType[t].comments += metricNumber(p, "comments"); });
  const engItems = Object.keys(engagementByType).map((t) => { const x = engagementByType[t]; return { label: t, value: x.views ? ((x.likes + x.comments) / x.views * 100) : 0 }; }).sort((a, b) => b.value - a.value).slice(0, 8);
  const maxEng = Math.max(1, Math.max.apply(null, engItems.map((x) => x.value)));
  const engChart = engItems.length ? <div className="metric-chart-bars">{engItems.map((x) => <div key={x.label} className="metric-bar-row"><div className="metric-bar-label"><span>{escapeHtml(x.label)}</span></div><div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${x.value / maxEng * 100}%`, background: pl.shade }} /></div><div className="metric-bar-value">{x.value.toFixed(2)}%</div></div>)}</div> : <div className="empty-metrics">No engagement data yet.</div>;

  // Platform-specific trend from snapshots
  const platformTrendViews = snapshotTrendData(platformSnapshots, "views");
  const platformTrendLikes = snapshotTrendData(platformSnapshots, "likes");

  return (
    <>
      <KPICards summary={summary} snapshotSummary={null} />

      {/* Current metrics + platform-specific */}
      <div className="chart-card">
        <h3>Current metrics</h3>
        <div className="chart-subtitle">From posts table + latest snapshot</div>
        <table className="analysis-table">
          <thead><tr><th>Metric</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Views</td><td className="num">{formatMetric(metricNumber(pool[0] || null, "views"))}</td></tr>
            <tr><td>Likes</td><td className="num">{formatMetric(metricNumber(pool[0] || null, "likes"))}</td></tr>
            <tr><td>Comments</td><td className="num">{formatMetric(metricNumber(pool[0] || null, "comments"))}</td></tr>
            <tr><td>Shares</td><td className="num">
              {latestSnap ? formatMetric(latestSnap.shares) : "—"}
              {latestSnap ? <span className="kpi-sub">latest snapshot</span> : <span className="kpi-sub">No snapshot data</span>}
            </td></tr>
          </tbody>
        </table>
      </div>

      {/* Platform-specific metrics JSON */}
      <div className="chart-card">
        <h3>Platform-specific metrics</h3>
        <div className="chart-subtitle">From latest snapshot's <code>platform_metrics</code> JSON</div>
        {platformMetricsSummary(latestSnap)}
      </div>

      {/* Platform historical trend charts */}
      <LineTrendChart dates={platformTrendViews.dates} values={platformTrendViews.values} title={`${pl.name} views trend`} subtitle="Daily views from snapshots" metricLabel="views" />
      <LineTrendChart dates={platformTrendLikes.dates} values={platformTrendLikes.values} title={`${pl.name} likes trend`} subtitle="Daily likes from snapshots" metricLabel="likes" />

      <div className="metrics-grid">
        <div className="chart-card"><h3>Views trend</h3><div className="chart-subtitle">Recorded views by upload date</div>{viewsTrendChart(pool)}</div>
        <div className="chart-card"><h3>Content mix</h3><div className="chart-subtitle">Posts by content type</div>{contentTypeChart(pool)}</div>
      </div>
      <div className="metrics-grid equal">
        <div className="chart-card"><h3>Engagement by content type</h3><div className="chart-subtitle">Rate based on recorded views</div>{engChart}</div>
        <div className="chart-card"><h3>Publishing activity</h3><div className="chart-subtitle">Posts by day of week</div>{weekdayChart(pool)}</div>
      </div>
      <div className="chart-card">
        <h3>Top {escapeHtml((pl as any).name)} posts</h3>
        <div className="chart-subtitle">
          Sort by{" "}
          <select value={topPostsMetric} onChange={(e) => onTopPostsMetricChange(e.target.value)} style={{ fontSize: ".68rem", padding: "2px 6px", borderRadius: "5px", border: "1px solid var(--border)", background: "var(--panel)", color: "var(--text)" }}>
            {METRIC_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        {topPostsHtml(pool, topPostsMetric, METRIC_OPTIONS)}
      </div>
    </>
  );
}

// ── Render Performance Analysis ──
function renderPerformanceAnalysis(pool: Post[], metric: string, dim: string) {
  if (!pool.length) return <div className="empty-metrics">No posts available for analysis.</div>;
  function val(p: Post) { const v = Number((p as any)[metric]); return Number.isFinite(v) ? v : 0; }
  function engagement(p: Post) { const v = Number((p as any).views || 0); return v ? ((Number((p as any).likes || 0) + Number((p as any).comments || 0)) / v * 100) : 0; }
  const groups: Record<string, Post[]> = {};
  pool.forEach((p) => { const k = dim === "contentType" ? (p.contentType || "Other") : (platformDataMap as any)[p.platform].name; if (!groups[k]) groups[k] = []; groups[k].push(p); });
  const rows = Object.keys(groups).map((k) => { const a = groups[k]; const total = a.reduce((s, p) => s + val(p), 0); const er = a.reduce((s, p) => s + engagement(p), 0) / a.length; return { key: k, count: a.length, total, avg: total / a.length, eng: er }; }).sort((a, b) => b.avg - a.avg);
  const best = rows[0], worst = rows[rows.length - 1];
  return <>
    <div className="analysis-controls">
      <select id="analysisMetric" value={metric}>
        {METRIC_OPTIONS.map((opt) => <option key={opt.value} value={opt.value} selected={metric === opt.value}>{opt.label}</option>)}
      </select>
      <select id="analysisDimension" value={dim}>
        <option value="contentType" selected={dim === "contentType"}>By content type</option>
        <option value="platform" selected={dim === "platform"}>By platform</option>
      </select>
    </div>
    <div className="analysis-grid">
      <div className="analysis-card"><span>Best average</span><strong>{escapeHtml(best.key)}</strong></div>
      <div className="analysis-card"><span>Highest average</span><strong>{formatMetric(best.avg)}</strong></div>
      <div className="analysis-card"><span>Lowest average</span><strong>{escapeHtml(worst.key)}</strong></div>
    </div>
    <div className="chart-card">
      <h3>Performance breakdown</h3>
      <div className="chart-subtitle">Average results per post.</div>
      <table className="analysis-table">
        <thead><tr><th>Group</th><th>Posts</th><th>Average</th><th>Total</th><th>Engagement</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{escapeHtml(r.key)}</td><td className="num">{r.count}</td><td className="num">{formatMetric(r.avg)}</td><td className="num">{formatMetric(r.total)}</td><td className="num">{r.eng.toFixed(2)}%</td></tr>)}</tbody>
      </table>
    </div>
  </>;
}

// ── Main Metrics Component ──
export const Metrics: React.FC<{
  metricsTab: string;
  onTabChange: (tab: string) => void;
  posts: Post[];
  analysisMetric: string;
  onAnalysisMetricChange: (m: string) => void;
  analysisDimension: string;
  onAnalysisDimensionChange: (d: string) => void;
  // Phase 3 — Date range
  dateRange: DateRange;
  dateRangeType: string;
  onDateRangeTypeChange: (type: DateRangeType) => void;
  customStartDate: string;
  customEndDate: string;
  onCustomStartDateChange: (val: string) => void;
  onCustomEndDateChange: (val: string) => void;
  // Phase 3 — Snapshots
  snapshots: MetricSnapshot[];
  snapshotLoading: boolean;
  snapshotError: string | null;
}> = ({
  metricsTab, onTabChange, posts, analysisMetric, onAnalysisMetricChange, analysisDimension, onAnalysisDimensionChange,
  dateRange, dateRangeType, onDateRangeTypeChange, customStartDate, customEndDate, onCustomStartDateChange, onCustomEndDateChange,
  snapshots, snapshotLoading, snapshotError,
}) => {
  const { showToast } = useToast();

  // Filter posts by date range (by publication date)
  const pool = (metricsTab === "all" ? posts : posts.filter((p) => p.platform === metricsTab));
  const rangedPool = React.useMemo(() => filterPostsByDateRange(pool, dateRange), [pool, dateRange]);

  // Filter snapshots by date range (by capture date)
  const rangedSnapshots = React.useMemo(() => {
    if (!dateRange.startDate) return snapshots;
    const start = new Date(dateRange.startDate);
    const end = new Date(dateRange.endDate + "T23:59:59");
    return snapshots.filter((s) => {
      const d = new Date(s.capturedAt);
      return d >= start && d <= end;
    });
  }, [snapshots, dateRange]);

  // Platform-specific snapshots
  const platformSnapshots = React.useMemo(
    () => (metricsTab === "all" ? rangedSnapshots : rangedSnapshots.filter((s) => s.platform === metricsTab)),
    [rangedSnapshots, metricsTab]
  );

  // Derive all snapshot aggregates from the currently ranged records. This avoids
  // briefly rendering aggregates from the previous range while Supabase reloads.
  const activeSnapshotSummary = React.useMemo(
    () => getSnapshotSummary(rangedSnapshots),
    [rangedSnapshots]
  );
  const activeSnapshotPlatformStats = React.useMemo(
    () => getSnapshotPlatformStats(rangedSnapshots),
    [rangedSnapshots]
  );
  const activeTrendViews = React.useMemo(() => snapshotTrendData(rangedSnapshots, "views"), [rangedSnapshots]);
  const activeTrendLikes = React.useMemo(() => snapshotTrendData(rangedSnapshots, "likes"), [rangedSnapshots]);
  const activeTrendComments = React.useMemo(() => snapshotTrendData(rangedSnapshots, "comments"), [rangedSnapshots]);
  const activeTrendShares = React.useMemo(() => snapshotTrendData(rangedSnapshots, "shares"), [rangedSnapshots]);

  // Top posts sort metric state
  const [topPostsMetric, setTopPostsMetric] = React.useState("views");

  const title = metricsTab === "all" ? "Analytics overview" : (platformDataMap as any)[metricsTab].name + " analytics";
  const subtitle = metricsTab === "all" ? "Cross-platform performance from the data stored in this planner." : "Detailed performance breakdown for this platform.";

  return (
    <div id="metricsRoot" style={{ overflow: "visible", paddingBottom: 24 }}>
      <div className="metrics-head">
        <div className="metrics-head-copy">
          <h2>{escapeHtml(title)}</h2>
          <p>{escapeHtml(subtitle)}</p>
        </div>
        {/* Date Range Selector */}
        <DateRangeSelector
          dateRangeType={dateRangeType}
          onDateRangeTypeChange={onDateRangeTypeChange}
          customStart={customStartDate}
          customEnd={customEndDate}
          onCustomStartChange={onCustomStartDateChange}
          onCustomEndChange={onCustomEndDateChange}
        />
      </div>

      {/* Date range context */}
      <div className="metrics-context">
        Showing data from {escapeHtml(dateRange.startDate)} to {escapeHtml(dateRange.endDate)}.
        <strong>{rangedPool.length} posts</strong> · <strong>{rangedSnapshots.length} snapshots</strong>
      </div>

      {/* Snapshot loading/error */}
      {snapshotLoading && <div className="hint-bar">Loading historical snapshots…</div>}
      {snapshotError && <div className="hint-bar" style={{ color: "var(--error)" }}>Snapshot error: {escapeHtml(snapshotError)}</div>}

      {/* Metrics tabs */}
      <div className="metrics-tabs">
        <button type="button" className={`metrics-tab ${metricsTab === "all" ? "active" : ""}`} data-action="metrics-tab" data-platform="all" onClick={() => onTabChange("all")}>
          Overview
        </button>
        {PLATFORMS.map((p) => {
          const pd = platformDataMap[p];
          return (
            <button key={p} type="button" className={`metrics-tab ${metricsTab === p ? "active" : ""}`} data-action="metrics-tab" data-platform={p} onClick={() => onTabChange(p)}>
              <PlatformIcon platform={p} iconOnly /> {pd.name}
            </button>
          );
        })}
      </div>

      {renderPerformanceAnalysis(rangedPool, analysisMetric, analysisDimension)}

      {metricsTab === "all"
        ? renderMetricsOverview(
            rangedPool, rangedSnapshots, activeSnapshotSummary, activeSnapshotPlatformStats,
            { trendViews: activeTrendViews, trendLikes: activeTrendLikes, trendComments: activeTrendComments, trendShares: activeTrendShares },
            topPostsMetric, setTopPostsMetric,
          )
        : renderMetricsPlatform(
            metricsTab, rangedPool, rangedSnapshots, activeSnapshotPlatformStats,
            topPostsMetric, setTopPostsMetric, platformSnapshots,
          )}
    </div>
  );
};