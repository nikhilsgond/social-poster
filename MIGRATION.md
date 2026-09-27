# Planner migration notes

The uploaded planner is the visual and behavior reference.

Observed in the original file:
- Dark monochrome theme
- Bricolage Grotesque
- Calendar / Tables / Metrics views
- Bulk JSON import
- Post modal
- Metrics dashboard
- Drag/drop calendar interactions
- Undo/redo state
- LocalStorage persistence under `social_planner_posts_v2`
- Legacy migration from `sp_posts`

Migration rule:
1. Preserve UI and behavior.
2. Move state into React.
3. Replace LocalStorage persistence with Supabase.
4. Keep platform publishing in the Node.js backend.
5. Add APIs one platform at a time.
