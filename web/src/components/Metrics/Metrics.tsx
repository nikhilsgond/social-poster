// src/components/Metrics/Metrics.tsx
import React from "react";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { useToast } from "../common/Toast";
import type { Post } from "../../types/post";

const PLATFORMS = ["yt", "ig", "fb", "th", "li", "x"];

function metricNumber(post: Post | null, key: string): number {
  if (!post) return 0;
  const v = Number((post as any)[key]);
  return Number.isFinite(v) ? v : 0;
}

function metricSummary(pool: Post[]) {
  let views = 0, likes = 0, comments = 0;
  pool.forEach((p) => { views += metricNumber(p, "views"); likes += metricNumber(p, "likes"); comments += metricNumber(p, "comments"); });
  return { count: pool.length, views, likes, comments, avgViews: pool.length ? views / pool.length : 0, engagement: views ? ((likes + comments) / views) * 100 : 0 };
}

function formatMetric(n: number): string {
  n = Number(n) || 0; const abs = Math.abs(n);
  if (abs >= 1000000) return (n / 1000000).toFixed(abs >= 10000000 ? 0 : 1) + "M";
  if (abs >= 1000) return (n / 1000).toFixed(abs >= 100000 ? 0 : 1) + "K";
  return Math.round(n).toLocaleString();
}

function escapeHtml(str: string): string {
  if (!str) return "";
  // @ts-ignore
  return str.replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
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
  if (diff < min) return "just now"; if (diff < hr) return Math.floor(diff / min) + "m ago";
  if (diff < day) return Math.floor(diff / hr) + "h ago";
  if (diff < day * 30) return Math.floor(diff / day) + "d ago";
  return new Date(Number(ts)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function contentTypeChart(pool: Post[]) {
  const counts: Record<string, number> = {};
  pool.forEach((p) => { const t = p.contentType || "Other"; counts[t] = (counts[t] || 0) + 1; });
  const items = Object.keys(counts).map((k) => ({ label: k, value: counts[k] })).sort((a, b) => b.value - a.value).slice(0, 8);
  if (!items.length) return <div className="empty-metrics">No content-type data yet.</div>;
  const max = Math.max(1, Math.max.apply(null, items.map((x) => x.value)));
  return <div className="metric-chart-bars">{items.map((x) => <div key={x.label} className="metric-bar-row"><div className="metric-bar-label"><span>{escapeHtml(x.label)}</span></div><div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${x.value / max * 100}%`, background: "var(--text)" }} /></div><div className="metric-bar-value">{x.value}</div></div>)}</div>;
}

function donutChart(items: { key: string; value: number }[]) {
  const total = items.reduce((a, x) => a + x.value, 0);
  if (!total) return <div className="empty-metrics">No posts yet.</div>;
  let angle = 0; const stops: string[] = [];
  items.forEach((x) => { const p = (platformDataMap as any)[x.key as any]; const next = angle + (x.value / total * 360); stops.push(`${p.shade} ${angle}deg ${next}deg`); angle = next; });
  return <div className="donut-layout"><div className="donut" style={{ background: `conic-gradient(${stops.join(",")})` }}><div className="donut-center"><strong>{formatMetric(total)}</strong><span>posts</span></div></div><div className="donut-legend">{items.map((x) => { const p = (platformDataMap as any)[x.key as any]; return <div key={x.key} className="legend-item"><i className="legend-dot" style={{ background: p.shade }} /> <b>{escapeHtml(p.name)}</b><span>{x.value}</span></div>; })}</div></div>;
}

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
  const grids = [0, .5, 1].map((r) => { const y = T + innerH * r; return <line key={r} x1={L} x2={W - R} y1={y} y2={y} className="trend-grid" />; }).join("");
  let labels = "";
  [0, Math.floor((dates.length - 1) / 2), dates.length - 1].forEach((i) => { if (i < 0) return; const pt = points[i]; labels += <text key={i} x={pt[0]} y={H - 9} textAnchor="middle" className="trend-label">{escapeHtml(prettyDateShort(dates[i]))}</text>; });
  const dots = points.map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r="3" className="trend-dot" />);
  return <div className="trend-wrap"><svg viewBox={`0 0 ${W} ${H}`} className="trend-svg" role="img" aria-label="Views over time">{grids}<polyline points={poly} className="trend-line" />{dots}{labels}</svg></div>;
}

function weekdayChart(pool: Post[]) {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const counts = [0, 0, 0, 0, 0, 0, 0];
  pool.forEach((p) => { if (!p.date) return; const a = p.date.split("-"); const d = new Date(Number(a[0]), Number(a[1]) - 1, Number(a[2])); const idx = (d.getDay() + 6) % 7; counts[idx]++; });
  const max = Math.max(1, Math.max.apply(null, counts));
  return <div className="weekday-grid">{names.map((n, i) => <div key={n} className="weekday-col"><span className="weekday-value">{counts[i]}</span><div className="weekday-track"><div className="weekday-fill" style={{ height: `${counts[i] / max * 100}%` }} /></div><span className="weekday-name">{n}</span></div>)}</div>;
}

function topPostsHtml(pool: Post[]) {
  const list = pool.slice().sort((a, b) => metricNumber(b, "views") - metricNumber(a, "views")).slice(0, 5);
  if (!list.length) return <div className="empty-metrics">No posts available.</div>;
  return <div className="top-posts">{list.map((p, i) => { const pl = (platformDataMap as any)[p.platform]; return <div key={p.id} className="top-post"><div className="top-post-rank">{i + 1}</div><div className="top-post-main"><div className="top-post-title">{escapeHtml((p.title || p.topic || p.content || "").slice(0, 75) + ((p.title || p.topic || p.content || "").length > 75 ? "\u2026" : ""))}</div><div className="top-post-meta"><PlatformIcon platform={p.platform} iconOnly /><span>{escapeHtml((pl as any).name)}</span><span>\u00b7</span><span>{escapeHtml(prettyDateShort(p.date))}{p.time ? ` \u00b7 ${escapeHtml(p.time)}` : ""}</span></div></div><div className="top-post-metric">{formatMetric(metricNumber(p, "views"))} views</div></div>; })}</div>;
}

function metricBarChart(items: { key: string; views: number; engagement: number; posts: number }[], valueKey: string, percentMode: boolean) {
  const max = Math.max(1, Math.max.apply(null, items.map((x) => Number((x as any)[valueKey]) || 0)));
// @ts-ignore
  return <div className="metric-chart-bars">{items.map((x) => { const v = Number((x as any)[valueKey]) || 0; const pct = (v / max) * 100; const pd = (platformDataMap as any)[x.key as any]; return <div key={x.key} className="metric-bar-row"><div className="metric-bar-label"><PlatformIcon platform={x.key} iconOnly /><span>{escapeHtml(pd.name)}</span></div><div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${Math.max(v ? 2 : 0, pct)}%`, background: pd.shade }} /></div><div className="metric-bar-value">{percentMode ? v.toFixed(2) + "%" : formatMetric(v)}</div></div>; })}</div>;
}

function KPICards({ summary }: { summary: ReturnType<typeof metricSummary> }) {
  return <div className="kpi-grid">{[
    { label: "Posts", value: formatMetric(summary.count), sub: "scheduled / published" },
    { label: "Views", value: formatMetric(summary.views), sub: "total recorded" },
    { label: "Likes", value: formatMetric(summary.likes), sub: "total recorded" },
    { label: "Comments", value: formatMetric(summary.comments), sub: "total recorded" },
    { label: "Avg views / post", value: formatMetric(summary.avgViews), sub: "based on recorded views" },
    { label: "Engagement", value: `${summary.engagement.toFixed(2)}%`, sub: "(likes + comments) / views" },
  ].map(k => <div key={k.label} className="kpi-card"><div className="kpi-label">{k.label}</div><div className="kpi-value">{k.value}</div><div className="kpi-sub">{k.sub}</div></div>)}</div>;
}

function renderMetricsOverview(pool: Post[]) {
  const stats = PLATFORMS.map((p) => { const ps = pool.filter((x) => x.platform === p); const s = metricSummary(ps); return { key: p, posts: s.count, views: s.views, engagement: s.engagement }; });
  const summary = metricSummary(pool);
  return <>
    <KPICards summary={summary} />
    <div className="metrics-grid"><div className="chart-card"><h3>Views by platform</h3><div className="chart-subtitle">Total recorded views</div>{metricBarChart(stats, "views", false)}</div><div className="chart-card"><h3>Engagement rate</h3><div className="chart-subtitle">Likes + comments divided by views</div>{metricBarChart(stats, "engagement", true)}</div></div>
    <div className="metrics-grid equal"><div className="chart-card"><h3>Content volume</h3><div className="chart-subtitle">Posts currently in the planner</div>{donutChart(stats.map(x => ({ key: x.key, value: x.posts })))}</div><div className="chart-card"><h3>Posts by platform</h3><div className="chart-subtitle">Count of scheduled / published items</div>{metricBarChart(stats, "posts", false)}</div></div>
    <div className="metrics-grid equal"><div className="chart-card"><h3>Top posts</h3><div className="chart-subtitle">Highest recorded views</div>{topPostsHtml(pool)}</div><div className="chart-card"><h3>Publishing activity</h3><div className="chart-subtitle">Posts by day of week</div>{weekdayChart(pool)}</div></div>
  </>;
}

function renderMetricsPlatform(key: string, pool: Post[]) {
  const pl = (platformDataMap as any)[key];
  const summary = metricSummary(pool);
  const engagementByType: Record<string, { views: number; likes: number; comments: number }> = {};
  pool.forEach((p) => { const t = p.contentType || "Other"; if (!engagementByType[t]) engagementByType[t] = { views: 0, likes: 0, comments: 0 }; engagementByType[t].views += metricNumber(p, "views"); engagementByType[t].likes += metricNumber(p, "likes"); engagementByType[t].comments += metricNumber(p, "comments"); });
  const engItems = Object.keys(engagementByType).map((t) => { const x = engagementByType[t]; return { label: t, value: x.views ? ((x.likes + x.comments) / x.views * 100) : 0 }; }).sort((a, b) => b.value - a.value).slice(0, 8);
  const maxEng = Math.max(1, Math.max.apply(null, engItems.map((x) => x.value)));
  const engChart = engItems.length ? <div className="metric-chart-bars">{engItems.map((x) => <div key={x.label} className="metric-bar-row"><div className="metric-bar-label"><span>{escapeHtml(x.label)}</span></div><div className="metric-bar-track"><div className="metric-bar-fill" style={{ width: `${x.value / maxEng * 100}%`, background: pl.shade }} /></div><div className="metric-bar-value">{x.value.toFixed(2)}%</div></div>)}</div> : <div className="empty-metrics">No engagement data yet.</div>;
// @ts-ignore
  return <>
// @ts-ignore
    <KPICards summary={summary} />
    <div className="metrics-grid"><div className="chart-card"><h3>Views trend</h3><div className="chart-subtitle">Recorded views by upload date</div>{viewsTrendChart(pool)}</div><div className="chart-card"><h3>Content mix</h3><div className="chart-subtitle">Posts by content type</div>{contentTypeChart(pool)}</div></div>
    <div className="metrics-grid equal"><div className="chart-card"><h3>Engagement by content type</h3><div className="chart-subtitle">Rate based on recorded views</div>{engChart}</div><div className="chart-card"><h3>Publishing activity</h3><div className="chart-subtitle">Posts by day of week</div>{weekdayChart(pool)}</div></div>
    <div className="chart-card"><h3>Top {escapeHtml((pl as any).name)} posts</h3><div className="chart-subtitle">Highest recorded views</div>{topPostsHtml(pool)}</div>
  </>;
}

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
      <select id="analysisMetric" value={metric}><option value="views" selected={metric === "views"}>Views</option><option value="likes" selected={metric === "likes"}>Likes</option><option value="comments" selected={metric === "comments"}>Comments</option></select>
      <select id="analysisDimension" value={dim}><option value="contentType" selected={dim === "contentType"}>By content type</option><option value="platform" selected={dim === "platform"}>By platform</option></select>
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

export const Metrics: React.FC<{ metricsTab: string; onTabChange: (tab: string) => void; posts: Post[]; analysisMetric: string; onAnalysisMetricChange: (m: string) => void; analysisDimension: string; onAnalysisDimensionChange: (d: string) => void }> = ({ metricsTab, onTabChange, posts, analysisMetric, onAnalysisMetricChange, analysisDimension, onAnalysisDimensionChange }) => {
  const { showToast } = useToast();
  const pool = metricsTab === "all" ? posts : posts.filter((p) => p.platform === metricsTab);
  const title = metricsTab === "all" ? "Analytics overview" : (platformDataMap as any)[metricsTab].name + " analytics";
  const subtitle = metricsTab === "all" ? "Cross-platform performance from the data stored in this planner." : "Detailed performance breakdown for this platform.";
  return (
    <div id="metricsRoot" style={{ overflow: "visible", paddingBottom: 24 }}>
      <div className="metrics-head">
        <div className="metrics-head-copy">
          <h2>{escapeHtml(title)}</h2>
          <p>{escapeHtml(subtitle)}</p>
        </div>
      </div>
      <div className="metrics-tabs">
        <button type="button" className={`metrics-tab ${metricsTab === "all" ? "active" : ""}`} data-action="metrics-tab" data-platform="all" onClick={() => onTabChange("all")}>Overview</button>
        {PLATFORMS.map((p) => (
          <button key={p} type="button" className={`metrics-tab ${metricsTab === p ? "active" : ""}`} data-action="metrics-tab" data-platform={p} onClick={() => onTabChange(p)}>
  // @ts-ignore
// @ts-ignore
          </button>
        ))}
      </div>
      {renderPerformanceAnalysis(pool, analysisMetric, analysisDimension)}
      {metricsTab === "all" ? renderMetricsOverview(pool) : renderMetricsPlatform(metricsTab, pool)}
    </div>
  );
};
