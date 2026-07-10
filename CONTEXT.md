# CONTEXT.md — Read this before changing anything

Written for whoever (human or AI assistant) picks up this repo after
forking it — including future-you in six months. Covers the
architecture and a list of real bugs that have already happened once,
so they don't happen again.

## 1. What this actually is, in three sentences

A dashboard for personal projects, built from Markdown files — there is
no database, the `.md` files in `projects/`+`actions/` **are** the data.
Two views exist: a public one (static JSON, safe to expose) and a
private one (same data plus sensitive fields, gated by a password
behind a Netlify Function). Two optional side-branches — AI task
scheduling and a weekly Telegram report — read the same data but don't
touch the main dashboard's code path.

Not a multi-user app. No real auth system beyond a shared password —
that's a deliberate simplification, not an oversight; don't over-engineer
auth unless this is actually going to be used by more than one person.

## 2. Data flow

```
projects/*.md, actions/*.md  (source of truth, plain Markdown + YAML frontmatter)
        ↓
scripts/build-data.js  (Node, build-time)
   - parses frontmatter with gray-matter
   - reads git log per file for activity dates
   - resolves parent-project nesting, wikilink action↔project links
   - excludes archived subtrees
        ↓
public/data-public.json          (only visibility: public projects, goal always null)
netlify/functions/data-private.json   (everything, served only after password check)
        ↓
src/main.js + src/style.css   (vanilla JS, no framework, client-side routing)
```

Everything downstream of `build-data.js` — the Report tab's streaks,
velocity, deadline/KPI math, the heatmap breakdowns — is computed
**client-side in `main.js`** from data that's already in the DTO. This
matters: most new analytics features don't require touching
`build-data.js` at all, because the raw ingredients (`activity` map,
`commitCount`, `checklist.done/total`) are already there. Check what's
already in the DTO before adding a new build-time field.

## 3. Known pitfalls — read before you repeat one of these

1. **`__dirname` collision in Netlify Functions.** Netlify auto-injects
   `__dirname` when bundling ESM functions. Declaring
   `const __dirname = path.dirname(fileURLToPath(import.meta.url))`
   yourself throws `Identifier '__dirname' has already been declared`.
   Use a different name (`currentDir`, whatever) — see
   `netlify/functions/private-data.js` for the working pattern.

2. **Netlify Functions here use the v2 API.** `export default async
   (req) => {...}`, with `export const config = { path: "..." }`. You
   **must** return a real `Response` object
   (`new Response(body, { status, headers })`) — not the old v1 shape
   `{ statusCode, headers, body }`. Mixing the two silently breaks the
   function. If you add a new function, copy the shape from an existing
   one rather than writing it from memory.

3. **YAML auto-parses unquoted dates into `Date` objects.** A frontmatter
   field written as `deadline: 2026-08-01` (no quotes) gets parsed by
   gray-matter/js-yaml as a native JS `Date`, and `JSON.stringify` turns
   it into `"2026-08-01T00:00:00.000Z"`. If downstream code then
   concatenates something like `+ "T00:00:00Z"` onto that string
   expecting a plain `YYYY-MM-DD`, you get an invalid date → `NaN`
   everywhere. Any date-like frontmatter field must go through a
   normalizer (see `toDateString()` in `build-data.js`) before landing
   in the DTO. This will bite you again the moment you add a new date
   field if you forget.

4. **A single malformed `.md` file must not crash the whole build.**
   `build-data.js` wraps frontmatter parsing per-file in try/catch and
   logs a warning (`⚠️ Bỏ qua project lỗi frontmatter: ...`) instead of
   throwing. Check the build log after bulk-editing frontmatter across
   many files — a silently-skipped file just disappears from the
   dashboard with no other symptom.

5. **Archiving a parent project must exclude the whole subtree, not
   just that one file.** If you touch the archive-filtering logic,
   test with a project that has grandchildren, not just direct
   children — it's easy to write a filter that only checks one level
   deep.

6. **If your data source is a one-way sync (e.g. a note-taking app
   auto-pushing into this repo), never hand-edit files in
   `projects/`/`actions/` directly in this repo.** Whatever generates
   the sync will overwrite direct edits on its next run — sometimes
   within minutes. Edit at the actual source. This applies whether the
   edit comes from you, a teammate, or an AI assistant working in this
   repo — a local/direct edit here is never durable if something else
   owns that folder.

7. **`goal` (or any field you decide is "private by nature") needs an
   explicit code-level guarantee, not just a naming convention.** The
   pattern used here: `toProjectDTO()` takes a `publicOnly` flag, and
   the sensitive field is set to `null` unconditionally when
   `publicOnly` is true — regardless of that project's own
   `visibility` setting. If you add another field that should never
   reach the public JSON, follow the same pattern rather than trusting
   yourself to remember to filter it elsewhere.

8. **Before committing changes to `build-data.js` or `main.js`, run:**
   ```bash
   node --check src/main.js && node --check scripts/build-data.js
   npm run build     # must complete with no errors
   ```
   If you touched anything related to a "private-only" field, also
   grep the generated `public/data-public.json` to confirm it's
   actually absent — don't just trust that the code looks right.

## 4. Design decisions that look arbitrary but aren't

- **Two JSON files instead of one with a client-side filter.** A
  single dataset with client-side visibility filtering would leak the
  private data to anyone who opens devtools and reads the network
  response — the private JSON is only ever served after a password
  check, from a serverless function, never bundled into the public
  static build.
- **Client-side routing via `history.pushState`, no framework.** Small
  enough surface area that React/Vue would be pure overhead. This does
  mean the site *must* be served with an SPA fallback redirect
  (`/* → /index.html`, already in `netlify.toml`) — opening
  `dist/index.html` via `file://` won't route correctly; use
  `npm run preview`.
- **`scripts/export-tasks.js` duplicates matching logic from
  `build-data.js` instead of importing it.** This is a known,
  accepted drift risk — if you extend how `build-data.js` matches
  parent projects or normalizes fields, remember `export-tasks.js`
  won't automatically pick up the change. Fine for a low-frequency
  personal script; would be worth refactoring into a shared module if
  this repo grows more automation branches that need the same parsing.

## 5. If you're extending this template

- New analytics/report feature → check the existing DTO fields first
  (section 2) before adding new build-time computation.
- New sensitive field → follow the `publicOnly` pattern (pitfall #7).
- New date field → run it through a date-string normalizer (pitfall #3).
- New Netlify Function → copy the shape of an existing one, don't
  write the response format from memory (pitfall #2).
