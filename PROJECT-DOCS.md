# Social Poster — Project Documentation

A social media publishing/scheduling backend for a "Social Planner" React frontend. Connects to Supabase (posts DB) and publishes to Instagram, Threads, YouTube, and Facebook.

## Project Tree

```
social-poster/
├── db/
│   ├── metrics-snapshots.sql        # Phase 1: post_metric_snapshots table + upsert RPC
│   ├── posts.sql                    # Posts table placeholder (created manually in Supabase)
│   └── storage.sql                  # Storage setup placeholder
├── server/                          # Node.js/TypeScript HTTP backend (port 3001)
│   ├── .env                         # Local secrets (NOT committed)
│   ├── .env.example                 # Env var template
│   ├── .yt-oauth-tokens.json        # YouTube OAuth tokens (local only)
│   ├── package.json                 # Server deps + scripts
│   ├── tsconfig.json
│   ├── apply-migration.ts           # One-time script to apply DB migration
│   ├── src/
│   │   ├── index.ts                 # HTTP server + routes
│   │   ├── posts.ts                 # Post query/update functions (DB layer)
│   │   ├── due-post-worker.ts       # IG/Threads worker invoked by the authenticated HTTP route
│   │   ├── test-mode.ts             # Test mode (dry-run publishing)
│   │   ├── types/
│   │   │   └── index.ts             # Shared types: Post, Platform, PostStatus
│   │   ├── lib/
│   │   │   ├── supabase.ts          # Lazy Supabase client (service-role key proxy)
│   │   │   ├── logger.ts            # logInfo / logWarn / logError with sanitization
│   │   │   ├── errors.ts            # Custom error classes
│   │   │   ├── instagram.ts         # Instagram Graph API client
│   │   │   ├── threads.ts           # Threads Graph API client
│   │   │   ├── youtube.ts           # YouTube OAuth2 client
│   │   │   └── facebook.ts          # Facebook Graph API client
│   │   ├── platforms/
│   │   │   ├── router.ts            # routePublisher() — selects publisher by platform
│   │   │   └── publishers/
│   │   │       ├── interface.ts     # PlatformPublisher interface
│   │   │       ├── instagram.ts
│   │   │       ├── threads.ts
│   │   │       ├── youtube.ts
│   │   │       └── facebook.ts
│   │   └── metrics/
│   │       ├── index.ts             # Barrel export
│   │       ├── interface.ts         # MetricProvider, MetricResult, SyncReport types
│   │       ├── sync.service.ts      # SyncMetricsService — orchestrates all platform syncs
│   │       └── providers/
│   │           ├── instagram.ts     # Instagram metrics (Graph API insights)
│   │           ├── threads.ts       # Threads metrics (Graph API insights)
│   │           ├── youtube.ts       # YouTube metrics (Data API v3)
│   │           └── facebook.ts      # Facebook metrics (Graph API insights)
│   └── oauth-youtube-helper.mjs     # Helper to obtain YouTube OAuth refresh token
├── web/                             # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── BulkImport/
│   │   │   ├── Metrics/Metrics.tsx
│   │   │   ├── Post/PostModal.tsx
│   │   │   ├── Tables/Tables.tsx
│   │   │   └── common/PlatformIcon.tsx, Toast.tsx
│   │   ├── context/PostContext.tsx
│   │   ├── hooks/usePosts.ts
│   │   ├── lib/
│   │   │   ├── supabase.ts
│   │   │   ├── supabasePosts.ts
│   │   │   ├── cloudinary.ts
│   │   │   ├── contentTypes.ts
│   │   │   ├── data.ts
│   │   │   ├── index.ts
│   │   │   ├── metrics.ts
│   │   │   └── validation.ts
│   │   ├── types/post.ts
│   │   ├── main.tsx
│   │   └── index.css
│   └── package.json
├── package.json                     # Root: monorepo scripts (web + server)
└── README.md
```

## Architecture

### Backend (`server/`)

A bare Node.js HTTP server (no Express) running TypeScript via `tsx`. Listens on port 3001.

**Startup flow:**
1. Loads `.env` via dotenv
2. Validates required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`)
3. Verifies Supabase connection
4. Starts listening

**Supabase client:** `server/src/lib/supabase.ts` exports `supabaseServer` — a lazy Proxy that creates the client on first access (after dotenv has loaded env vars). Uses the service-role key, so it bypasses RLS.

### Frontend (`web/`)

A React + TypeScript + Vite + Tailwind app. Connects to the same Supabase instance (client-side, with RLS). Communicates with the backend via HTTP.

## HTTP Server Routes (`server/src/index.ts`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check — returns `{ status: "ok" }` |
| POST | `/test` | Test mode — runs publishers without modifying status |
| POST | `/posts/due` | Authenticated worker that claims and publishes due IG/Threads posts |
| GET | `/posts/:id` | Returns a single post by UUID |
| POST | `/publish/:id` | Immediate publish (only if scheduled_at is past) |
| POST | `/schedule/:id` | Native future scheduling (YouTube/Facebook) |
| GET | `/verify-facebook` | Verifies Facebook page access token |
| POST | `/metrics/sync` | **Phase 1** — syncs metrics from all configured platforms |

## Publishing Architecture

### Router (`server/src/platforms/router.ts`)

`routePublisher(post: Post)` selects the correct `PlatformPublisher` based on `post.platform`:
- `"yt"` → `YouTubePublisher`
- `"ig"` → `InstagramPublisher`
- `"th"` → `ThreadsPublisher`
- `"fb"` → `FacebookPublisher`

### Platform Publishers

Each publisher implements the `PlatformPublisher` interface (`publish(post)` → `PublishResult`):

- **Instagram** (`publishers/instagram.ts`): Container-based publishing via Graph API. Creates a media container, then publishes it. Supports images, reels, and stories.
- **Threads** (`publishers/threads.ts`): Container-based publishing via Threads Graph API (graph.threads.net).
- **YouTube** (`publishers/youtube.ts`): OAuth2 refresh token flow. Uploads video as private with `publishAt` for native scheduling. Removed the early-return guard for future-dated posts (now uploads immediately with `publishAt=scheduledAt`).
- **Facebook** (`publishers/facebook.ts`): Text/image/link posts with `published=false` + `scheduled_publish_time` for native scheduling.

### Due-post worker (`server/src/due-post-worker.ts`)

Invoked through authenticated `POST /posts/due` by an external scheduler. It queries only due Threads (`th`) and Instagram (`ig`) rows, atomically claims each row, and uses the existing publishers.

## Phase 1: Metrics Synchronization

### Goal

Backend foundation for syncing current metrics from all 4 platforms (Instagram, Threads, YouTube, Facebook), updating the `posts` table metrics (`views`, `likes`, `comments`, `metrics_updated_at`), and saving historical snapshots to `post_metric_snapshots`.

### Key Files

| File | Purpose |
|------|---------|
| `metrics/interface.ts` | Types: `FetchedMetrics`, `MetricResult`, `MetricProvider`, `PlatformSyncResult`, `SyncReport` |
| `metrics/sync.service.ts` | `SyncMetricsService` — orchestrates the sync |
| `metrics/providers/instagram.ts` | `InstagramMetricsProvider` — Graph API v26.0 insights |
| `metrics/providers/threads.ts` | `ThreadsMetricsProvider` — Threads Graph API v1.0 insights |
| `metrics/providers/youtube.ts` | `YouTubeMetricsProvider` — Data API v3 video statistics |
| `metrics/providers/facebook.ts` | `FacebookMetricsProvider` — Graph API v26.0 page post insights |
| `metrics/index.ts` | Barrel export |
| `db/metrics-snapshots.sql` | DB migration: table, indexes, RPC function |

### Sync Flow

1. **`/metrics/sync` endpoint** (`index.ts`): Builds a `Map<string, MetricProvider>` from env-configured credentials. Only adds platforms with credentials present. Instantiates `SyncMetricsService(providers, 5)` and calls `syncAll()`.

2. **`SyncMetricsService.syncAll()`** (`sync.service.ts`):
   - Queries `posts` WHERE `status='published' AND platform_post_id IS NOT NULL`, ordered by `published_at` ASC
   - Groups posts by platform
   - For each platform with a provider, checks `isAvailable()`
   - Fetches metrics for each post with a concurrency limiter (max 5 simultaneous API calls)
   - On success: calls `updateMetrics()` (updates `posts.views/likes/comments/metrics_updated_at` only) and `upsertSnapshot()`
   - On failure: records error, continues (partial failure supported)
   - Returns a structured `SyncReport` with per-platform and summary stats

3. **Snapshot upsert** (`upsertSnapshot()`):
   - Calls `supabaseServer.rpc("upsert_metric_snapshot_raw", ...)` — uses the `ON CONFLICT` upsert with the unique index for duplicate prevention
   - Falls back to plain `insert()` if the RPC doesn't exist (migration not applied)
   - `captured_at` is pre-truncated to minute boundary by `minuteBoundary()` → unique index on `(post_id, captured_at)` enforces one-snapshot-per-post-per-minute

4. **Metrics update** (`posts.ts`):
   - `updateMetrics(id, metrics)` updates ONLY `views`, `likes`, `comments`, `metrics_updated_at`
   - Does NOT touch `status`, `platform_post_id`, `scheduled_at`, `published_at`
   - Does NOT add `shares` to `posts` (shares goes only in snapshots)

### Platform Metric Providers

| Provider | API | Endpoint | Metric Mapping |
|----------|-----|----------|----------------|
| Instagram | `graph.instagram.com/v26.0` | `GET /{media-id}/insights` | `likes→likes`, `comments→comments`, `shares→shares`, `views→views`, plus Reel/Story extras in `platformMetrics` |
| Threads | `graph.threads.net/v1.0` | `GET /{media-id}/insights` | `views→views`, `likes→likes`, `replies→comments`, `shares→shares`, `reposts`/`quotes` → `platformMetrics` |
| YouTube | `youtube/v3` | `GET /videos?part=statistics&id={videoId}` | `viewCount→views`, `likeCount→likes`, `commentCount→comments`. No shares metric. |
| Facebook | `graph.facebook.com/v26.0` | `GET /{post-id}/insights` | `post_reactions_like_total→likes`, `post_impressions→views`, `post_story_shares→shares`, comments fetched separately via `GET /{post-id}?fields=comments` |

### Platform Availability Handling

- **Instagram**: `isAvailable()` returns `true` — availability tested at runtime (real API call in `fetchMetrics`)
- **Threads**: Detects `threads_manage_insights` permission errors → returns `platformUnavailable: true`
- **YouTube**: Detects OAuth scope/quota issues → returns `platformUnavailable: true`
- **Facebook**: Retries with `access_token` in URL on 400 errors; detects permission errors → `platformUnavailable: true`

### Database Migration (`db/metrics-snapshots.sql`)

Creates:
1. **`public.post_metric_snapshots`** table — `id`, `post_id` (FK to posts), `platform`, `captured_at`, `views`, `likes`, `comments`, `shares`, `platform_metrics JSONB`
2. **3 indexes**: on `post_id`, `captured_at`, and `(post_id, captured_at)` for fast lookups
3. **Unique index**: `idx_snapshots_unique_minute` on `(post_id, captured_at)` — enforces one snapshot per post per minute (captured_at is pre-truncated by `minuteBoundary()` before insert)
4. **RPC function**: `upsert_metric_snapshot_raw()` — INSERT ... ON CONFLICT DO UPDATE for duplicate-safe upserts

**Note on `date_bin` vs `date_trunc`:** The original migration used `date_bin('1 minute'::interval, captured_at, '1 minute'::interval)` in the unique index, which failed with:
- `function date_bin(interval, timestamptz, interval) does not exist` — wrong 3rd argument type (needs timestamp, not interval)
- `42P17: functions in index expression must be marked IMMUTABLE` — `date_trunc`/`date_bin` on `timestamptz` is STABLE, not IMMUTABLE

**Fix:** Since `minuteBoundary()` pre-truncates `captured_at` to clean minute boundaries (e.g., `10:30:00.000Z`), the unique index uses `captured_at` directly — no function call needed. This satisfies the IMMUTABLE requirement (plain column reference).

### Environment Variables (`server/.env`)

```
SUPABASE_URL=                    # Supabase project URL
SUPABASE_SERVICE_ROLE_KEY=       # Service role key (bypasses RLS)
META_PAGE_ID=                    # Facebook Page ID
META_PAGE_ACCESS_TOKEN=          # Facebook Page Access Token
THREADS_USER_ID=                 # Threads user ID
THREAD_ACCESS_TOKEN=             # Threads access token
IG_USER_ID=                      # Instagram Business account ID
IG_ACCESS_TOKEN=                 # Instagram access token
YOUTUBE_CLIENT_ID=               # Google OAuth client ID
YOUTUBE_CLIENT_SECRET=           # Google OAuth client secret
YOUTUBE_REFRESH_TOKEN=           # YouTube OAuth refresh token
CLOUDINARY_CLOUD_NAME=           # Cloudinary cloud
CLOUDINARY_API_KEY=              # Cloudinary API key
CLOUDINARY_API_SECRET=           # Cloudinary API secret
```

## Development

### Start the server (dev)
```bash
cd server && npm run dev
# or: npx tsx src/index.ts
```

### Build
```bash
cd server && npm run build
# or: npx tsc
```

### Start the frontend
```bash
cd web && npm run dev
```

### Apply DB migration
Paste `db/metrics-snapshots.sql` into the Supabase SQL Editor, or run:
```bash
cd server && npx tsx apply-migration.ts
```

## Current State

- **TypeScript build:** passes (`tsc` clean)
- **DB migration:** `post_metric_snapshots` table + RPC function applied (corrected from `date_bin` to `date_trunc` → `captured_at` direct)
- **Server:** running on port 3001
- **`/metrics/sync` endpoint:** working — finds published posts, fetches metrics per platform, updates posts + creates snapshots
- **Known issue fixed:** YouTube provider read env vars at module load time (before dotenv), causing credential detection to fail. Fixed by reading env vars at call time inside `getYouTubeAccessToken()`.
- **Test data:** A test YouTube post (video ID `WgVsnwWMfTc`) was inserted for sync testing.

## Git Status

Changes not staged — `index.ts`, `youtube.ts` (publisher), `posts.ts` modified; `metrics/`, `metrics-snapshots.sql`, `apply-migration.ts` untracked. **Do NOT commit.**
