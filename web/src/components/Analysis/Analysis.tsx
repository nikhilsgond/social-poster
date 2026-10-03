import React, { useMemo, useState } from "react";
import type { Post } from "../../types/post";
import { PlatformIcon, platformDataMap } from "../common/PlatformIcon";
import { ANALYSIS_PLATFORMS, MIN_COHORT_SIZE, averageGroups, cohortKey, cohorts, engagement, engagementRate, filterAnalysisPosts, metric, performanceIndex, postPreview, postUrl, publicationParts, sortPosts, summarize, timeline } from "../../lib/analysis";
import type { ChartPoint, Filters, Range, Sort } from "../../lib/analysis";

const number = (value: number | null, digits = 0) => value === null ? "N/A" : value.toLocaleString(undefined, { maximumFractionDigits: digits });
const percent = (value: number | null) => value === null ? "N/A" : `${number(value, 2)}%`;
const platformName = (key: string) => platformDataMap[key as Post["platform"]]?.name || key;
const shortDate = (value: string) => value.length === 7 ? value : value.slice(5);

// SVG keeps charts lightweight; every point has a visible, keyboard-accessible tooltip.
function Chart({ title, subtitle, points, line = false, horizontal = false, dates = false }: { title: string; subtitle: string; points: ChartPoint[]; line?: boolean; horizontal?: boolean; dates?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const width = 640, height = horizontal ? Math.max(200, points.length * 32 + 40) : 225;
  const left = horizontal ? 145 : 52, right = 18, top = 15, bottom = 38;
  const max = Math.max(1, ...points.map(p => p.value ?? 0));
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = (i: number) => left + (i + .5) / Math.max(1, points.length) * plotWidth;
  const y = (v: number) => top + plotHeight - v / max * plotHeight;
  const step = Math.max(1, Math.ceil(points.length / 6));
  let previous = false;
  const path = points.map((p, i) => {
    if (p.value === null) { previous = false; return ""; }
    const command = `${previous ? "L" : "M"}${x(i)},${y(p.value)}`; previous = true; return command;
  }).join(" ");
  return <section className="chart-card analysis-chart">
    <h3>{title}</h3><p className="chart-subtitle">{subtitle}</p>
    {!points.length ? <p className="analysis-empty-chart">No published posts in this selection.</p> : <>
      <div className="analysis-plot"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={title}>
        {!horizontal && [0, .5, 1].map(t => <g key={t}><line x1={left} x2={width - right} y1={y(max * t)} y2={y(max * t)} className="analysis-gridline" /><text x={left - 8} y={y(max * t) + 4} textAnchor="end">{number(max * t)}</text></g>)}
        {horizontal && <><text x={left} y={height - 12}>0</text><text x={width - right} y={height - 12} textAnchor="end">{number(max, 1)}</text></>}
        {line && <path d={path} fill="none" stroke="#e5e5e5" strokeWidth="2" />}
        {points.map((point, i) => {
          const barWidth = Math.max(2, plotWidth / points.length * .65);
          const rowY = top + i * 32;
          const color = ANALYSIS_PLATFORMS.includes(point.label as any) ? platformDataMap[point.label as Post["platform"]].shade : "#a3a3a3";
          return <g key={point.label} tabIndex={0} role="img" aria-label={`${point.label}: ${number(point.value, 1)}${point.count !== undefined ? `; ${point.count} posts` : ""}`} onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}>
            <title>{`${point.label}: ${number(point.value, 1)}`}</title>
            {horizontal ? <><text x={left - 12} y={rowY + 12} textAnchor="end">{platformName(point.label).slice(0, 24)}</text><rect x={left} y={rowY} width={(point.value ?? 0) / max * plotWidth} height={16} fill={color} /><rect x={left} y={rowY - 3} width={plotWidth} height={25} fill="transparent" /></> : <>
              {line ? point.value !== null && <circle cx={x(i)} cy={y(point.value)} r={active === i ? 5 : 3} fill="#fafafa" /> : point.value !== null && <rect x={x(i) - barWidth / 2} y={y(point.value)} width={barWidth} height={plotHeight - (y(point.value) - top)} fill={color} />}
              <rect x={left + i / points.length * plotWidth} y={top} width={plotWidth / points.length} height={plotHeight} fill="transparent" />
              {(points.length <= 8 || i % step === 0 || i === points.length - 1) && <text x={x(i)} y={height - 12} textAnchor="middle">{dates ? shortDate(point.label) : point.label}</text>}
            </>}
          </g>;
        })}
      </svg></div>
      <div className="analysis-tooltip" aria-live="polite">{active !== null ? `${dates ? points[active]?.label : platformName(points[active]?.label || "")}: ${number(points[active]?.value ?? null, 1)}${points[active]?.count !== undefined ? ` · ${points[active].count} posts` : ""}` : "Hover or focus a chart point for its value"}</div>
    </>}
  </section>;
}

const SORT_OPTIONS: Array<[Sort, string]> = [["views", "Most Viewed"], ["engagement", "Most Engaged"], ["shares", "Most Shared"], ["comments", "Most Commented"], ["index", "Highest Performance Index"], ["newest", "Newest"], ["oldest", "Oldest"]];
export function Analysis({ posts }: { posts: Post[] }) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = publicationParts(new Date().toISOString(), timeZone).date;
  const [filters, setFilters] = useState<Filters>({ platform: "all", contentType: "all", range: "30d", start: today, end: today });
  const [sort, setSort] = useState<Sort>("views");
  const [page, setPage] = useState(1);
  const setFilter = (next: Partial<Filters>) => { setFilters(f => ({ ...f, ...next })); setPage(1); };
  const types = useMemo(() => [...new Set(posts.filter(p => p.status === "published" && (ANALYSIS_PLATFORMS as readonly string[]).includes(p.platform) && (filters.platform === "all" || p.platform === filters.platform)).map(p => p.contentType).filter(Boolean))].sort(), [posts, filters.platform]);
  const pool = useMemo(() => filterAnalysisPosts(posts, filters, timeZone), [posts, filters, timeZone, today]);
  const summary = useMemo(() => summarize(pool), [pool]);
  const groups = useMemo(() => cohorts(pool), [pool]);
  const indices = useMemo(() => { const map = new Map(groups.map(g => [g.key, g])); return new Map(pool.map(p => [p.id, performanceIndex(p, map.get(cohortKey(p)))])); }, [pool, groups]);
  const sorted = useMemo(() => sortPosts(pool, sort, indices), [pool, sort, indices]);
  const trends = useMemo(() => timeline(pool, timeZone), [pool, timeZone]);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = averageGroups(pool, p => weekdays[publicationParts(p.publishedAt!, timeZone).weekday]);
  const hours = averageGroups(pool, p => String(publicationParts(p.publishedAt!, timeZone).hour).padStart(2, "0"));
  const fill = (labels: string[], data: ChartPoint[]) => labels.map(label => data.find(p => p.label === label) || { label, value: null, count: 0 });
  const likesLabel = filters.platform === "fb" ? "Reactions" : filters.platform === "all" ? "Likes / Reactions" : "Likes";
  const coverage = (available: number) => `${available} / ${summary.count} posts with data`;
  const cards = [
    ["Total Views", number(summary.views.total), coverage(summary.views.available)],
    ["Total Engagements", number(summary.engagements.total), summary.partial ? "Partial · available metrics only" : "Likes/reactions + comments + shares"],
    ["Avg Views / Post", number(summary.avgViews, 1), coverage(summary.views.available)],
    ["Engagement Rate", percent(summary.rate), summary.partial ? "Partial · available engagements / views" : "Engagements / views"],
    ["Published Posts", number(summary.count), "In the selected publication cohort"],
    [`Avg ${likesLabel}`, number(summary.avgLikes, 1), coverage(summary.likes.available)],
    ["Avg Comments", number(summary.avgComments, 1), coverage(summary.comments.available)],
    ["Avg Shares", number(summary.avgShares, 1), coverage(summary.shares.available)],
  ];
  const formatDate = (timestamp: string) => new Date(timestamp).toLocaleString(undefined, { timeZone, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const preview = (post: Post) => { const url = postUrl(post); return url ? <a href={url} target="_blank" rel="noreferrer">{postPreview(post)} ↗</a> : <span>{postPreview(post)}</span>; };
  const pageCount = Math.max(1, Math.ceil(sorted.length / 25)), currentPage = Math.min(page, pageCount);
  return <div className="analysis-dashboard">
    <div className="metrics-head"><div className="metrics-head-copy"><h2>Content Analysis</h2><p>Current cumulative performance, grouped by actual publication date.</p></div></div>
    <div className="analysis-filters">
      <label>Platform<select value={filters.platform} onChange={e => setFilter({ platform: e.target.value as Filters["platform"], contentType: "all" })}><option value="all">All Platforms</option>{ANALYSIS_PLATFORMS.map(p => <option key={p} value={p}>{platformName(p)}</option>)}</select></label>
      <label>Date range<select value={filters.range} onChange={e => setFilter({ range: e.target.value as Range })}>{[["7d", "7D"], ["30d", "30D"], ["90d", "90D"], ["all", "All"], ["custom", "Custom"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Content Type<select value={filters.contentType} onChange={e => setFilter({ contentType: e.target.value })}><option value="all">All</option>{types.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
      {filters.range === "custom" && <><label>From<input type="date" value={filters.start} max={filters.end} onChange={e => setFilter({ start: e.target.value })} /></label><label>To<input type="date" value={filters.end} min={filters.start} onChange={e => setFilter({ end: e.target.value })} /></label></>}
    </div>
    <p className="analysis-note">{summary.count} published posts · {timeZone} · Averages exclude unavailable metrics. N/A means unavailable or an undefined calculation; reported zero remains 0.{summary.partial && " Engagement includes available metrics only; missing metrics are not counted as zero."}</p>
    <div className="analysis-kpis">{cards.map(([label, value, note]) => <div className="kpi-card" key={label}><div className="kpi-label">{label}</div><div className="kpi-value">{value}</div><div className="kpi-sub">{note}</div></div>)}</div>
    {!pool.length && <div className="empty-metrics">No published posts match these filters. Choose another platform, content type or date range.</div>}
    <div className="analysis-charts">
      <Chart title="Views Over Time" subtitle={`Current views of posts published each ${trends.grouping}; not views gained.`} points={trends.views} line dates />
      <Chart title="Engagement Over Time" subtitle={`Available engagements of posts published each ${trends.grouping}${summary.partial ? " · partial coverage" : ""}.`} points={trends.engagement} line dates />
      <Chart title="Posts Published Over Time" subtitle={`Published posts per ${trends.grouping}.`} points={trends.posts} dates />
      <Chart title="Performance by Platform" subtitle="Average views per post with view data." points={fill(filters.platform === "all" ? [...ANALYSIS_PLATFORMS] : [filters.platform], averageGroups(pool, p => p.platform))} horizontal />
      <Chart title="Performance by Content Type" subtitle="Average views per post with view data." points={averageGroups(pool, p => p.contentType || "Other").sort((a, b) => (b.value ?? -1) - (a.value ?? -1))} horizontal />
      <Chart title="Average Views by Weekday" subtitle={`Actual publication weekday · ${timeZone}.`} points={fill(weekdays, days)} />
      <Chart title="Average Views by Posting Hour" subtitle={`Actual publication hour (00–23) · ${timeZone}.`} points={fill(Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")), hours)} />
      <section className="chart-card"><h3>Top Posts</h3><p className="chart-subtitle">Ranked by current views within this selection.</p><ol className="analysis-top">{sortPosts(pool, "views", indices).slice(0, 5).map(p => <li key={p.id}><div>{preview(p)}<small><PlatformIcon platform={p.platform} iconOnly /> {platformName(p.platform)} · {p.contentType}</small></div><strong>{number(metric(p, "views"))}<small>views</small></strong></li>)}</ol>{!pool.length && <p className="analysis-empty-chart">No posts to rank.</p>}</section>
    </div>
    <section className="chart-card"><h3>Platform + Content Type</h3><p className="chart-subtitle">Cohorts use the same filters. Engagement averages include available metrics{summary.partial ? " · partial coverage" : ""}.</p><div className="analysis-table-wrap"><table className="analysis-table"><thead><tr>{["Platform", "Content Type", "Posts", "Total Views", "Avg Views", "Median Views", "Avg Engagement", "Engagement Rate"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{groups.map(g => <tr key={g.key}><td>{platformName(g.platform)}</td><td>{g.contentType}</td><td>{g.count}</td><td>{number(g.views.total)}</td><td>{number(g.avgViews, 1)}</td><td>{number(g.medianViews, 1)}</td><td>{number(g.avgEngagement, 1)}{g.partial && <small className="analysis-partial">partial</small>}</td><td>{percent(g.rate)}{g.partial && <small className="analysis-partial">partial</small>}</td></tr>)}</tbody></table></div>{!groups.length && <p className="analysis-empty-chart">No cohorts in this selection.</p>}</section>
    <section className="chart-card analysis-detail"><div className="analysis-table-head"><h3>Post Performance</h3><label>Sort by <select value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(1); }}>{SORT_OPTIONS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div><p className="chart-subtitle">Performance Index = views / cohort median. Requires {MIN_COHORT_SIZE}+ posts with view data and a nonzero median. N/A sorts after numeric values.</p>
      <div className="analysis-table-wrap"><table className="analysis-table analysis-post-table"><thead><tr>{["Post", "Platform", "Content Type", "Published At", "Views", likesLabel, "Comments", "Shares", "Engagement Rate", "Performance Index"].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{sorted.slice((currentPage - 1) * 25, currentPage * 25).map(p => {
        const index = indices.get(p.id) ?? null, partial = (["likes", "comments", "shares"] as const).some(k => metric(p, k) === null);
        return <tr key={p.id}><td>{preview(p)}</td><td><PlatformIcon platform={p.platform} iconOnly /> {platformName(p.platform)}</td><td>{p.contentType || "Other"}</td><td>{formatDate(p.publishedAt!)}</td><td>{number(metric(p, "views"))}</td><td>{number(metric(p, "likes"))}</td><td>{number(metric(p, "comments"))}</td><td>{number(metric(p, "shares"))}</td><td>{percent(engagementRate(engagement(p), metric(p, "views")))}{partial && <small className="analysis-partial">partial</small>}</td><td title={index === null ? `Requires ${MIN_COHORT_SIZE} posts with views and a nonzero cohort median` : "Relative to this filtered platform + content type cohort"}>{index === null ? "N/A" : `${number(index, 2)}x`}</td></tr>;
      })}</tbody></table></div>
      {!sorted.length && <p className="analysis-empty-chart">No posts in this selection.</p>}
      <div className="analysis-pagination"><span>{sorted.length} posts · Page {currentPage} of {pageCount}</span><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</button><button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    </section>
  </div>;
}
