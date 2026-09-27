# Social Planner

## Supabase Database Setup

### 1. Create/Open Your Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project (or open an existing one).
2. Note your **Project URL** and **anon/public key** from Project Settings → API.

### 2. Run the Schema

Open the **SQL Editor** in the Supabase dashboard and run:

```sql
-- Run the complete schema
-- This creates the posts table, enums, indexes, triggers, and RLS.
-- File: db/posts.sql
```

```bash
# Or use the Supabase CLI
supabase db reset
```

### 3. Verify the Schema

After running the SQL:

```sql
-- Verify the posts table exists
SELECT * FROM information_schema.tables WHERE table_name = 'posts';

-- Verify the enums
SELECT * FROM pg_type WHERE typname IN ('planner_platform', 'planner_status');

-- Verify indexes
SELECT indexname FROM pg_indexes WHERE tablename = 'posts';

-- Verify RLS
SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE tablename = 'posts';
```

### 4. Environment Variables

Copy `.env.example` to `.env.local` and fill in your real values:

```bash
cp .env.example .env.local
```

Then edit `.env.local`:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

**Never commit `.env.local`.** Only `.env.example` is committed with empty placeholders.

See `.env.example` for the template.

### 5. Application Architecture

```
React UI
   ↓
PostContext (useReducer)
   ↓
Repository Layer (src/lib/supabasePosts.ts)
   ↓
Supabase PostgreSQL
```

- **Source of truth**: Supabase (Phase 4+)
- **LocalStorage**: Cache only, not used as a second source of truth
- **Cloudinary**: Used for media storage. Supabase Storage is NOT used.
- **Media references**: Stored as `media_url` and `cloudinary_public_id` in the `posts` table.

### 6. RLS Configuration

Phase 4 uses the browser anon key. RLS policies must allow anon access for the app to function. The current policies are documented as a development approach. For production, add authentication with per-user policies.

**Security**: The browser only uses the publishable anon key. Service-role keys and database passwords are never exposed to the frontend.

---

## Phase 4 — Supabase Connection

Phase 4 connects the React planner to Supabase as the persistent data source.

### What changed

- `src/lib/supabase.ts` — Real Supabase client using `@supabase/supabase-js`
- `src/lib/supabasePosts.ts` — Repository layer with all CRUD operations
- `src/context/PostContext.tsx` — Connected to Supabase, added `loading`/`error` state and undo/redo
- `src/lib/data.ts` — Marked as cache-only (Supabase is source of truth)
- `.env.local` — Local credentials (gitignored)

### CRUD Flow

```
App starts → fetchPosts() → Supabase → Post[] → React state
Add Post → createPost() → Supabase INSERT → React state update
Edit Post → updatePost() → Supabase UPDATE → React state update
Delete Post → deletePost() → Supabase DELETE → React state update
Drag & Drop → movePost() → Supabase UPDATE → React state update
Bulk Import → createPosts() → Supabase INSERT → React state update
```

### Testing Checklist

- Initial load: Posts from Supabase appear in planner
- Add: Post saved to Supabase, visible after refresh
- Edit: Changes persisted to Supabase, visible after refresh
- Delete: Post removed from Supabase, gone after refresh
- Drag: New date persisted to Supabase, visible after refresh
- Bulk Import: All valid posts in Supabase, visible after refresh
- Cross-view: All views update from single React state
- Error handling: Network/RLS errors shown to user, no crashes

---

## Phase 2 Regression

All Phase 2 functionality (Calendar, Tables, Metrics, Add/Edit, Bulk Import, Drag & Drop) works unchanged.

---

## Phase 5 (Future)

Phase 5 will handle Cloudinary media uploads.
