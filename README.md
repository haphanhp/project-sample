# project-log — Markdown-driven personal project dashboard

A self-hosted dashboard that turns a folder of Markdown files into a
project tracker — no database, no SaaS subscription. Built from a real
personal setup, stripped down into a reusable template.

**What you get:**
- A dashboard reading `.md` files with YAML frontmatter (title, status,
  priority, tags...) — checklists, completion %, and a GitHub-style
  activity heatmap pulled straight from `git log`.
- A **public/private split** — one password-protected view with
  everything, one static public view showing only what you mark
  `visibility: public` (handy for a portfolio you can send to clients or
  recruiters without exposing your whole backlog).
- A **Report tab** — streaks, weekly velocity, stale-but-important
  projects, estimated completion dates, and a deadline/KPI table that
  auto-classifies projects as on-track / at-risk / overdue from real
  checklist data (not self-rated).
- An **hour-of-day activity chart** — see when you're actually
  productive, not just which days.
- Two optional automation branches: **AI task scheduling** (DeepSeek +
  Google Calendar — describe a time slot in plain language, it books
  real calendar events from your open tasks) and a **weekly strategy
  report** auto-sent to Telegram via GitHub Actions.

This repo ships with a handful of demo project files (`projects/`,
`actions/`) so you can see the system working immediately — replace
them with your own.

## Quick start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`. You'll see the 4 demo projects already in
`projects/`.

## Add your own project

Create `projects/your-project.md`:

```yaml
---
title: Your Project Name
description: One short line, shown under the title on the card.
tags: [project]
status: in-progress          # or "done" — inferred from checklist % if omitted
visibility: private            # "public" or "private". Omit = private (safe default)
priority: 1                     # lower number = shown first. Omit = sorts last
goal: some-personal-goal         # optional, groups projects by goal — ALWAYS hidden from the public view
deadline: 2026-08-01              # optional, powers the Deadline/KPI table on the Report tab
parent-project: parent-slug      # optional, nests under another project (unlimited depth)
link: https://your-demo.com       # optional, "Live demo" button
repo: https://github.com/you/repo # optional, "Repo" button
started: 2026-01-10                # optional, defaults to file creation date
---

## Checklist

- [x] Done item
- [ ] Not-done item
```

Only lines shaped like `- [ ] ...` / `- [x] ...` count toward the
checklist — everything else in the file is free-form notes.

**Full field reference:** `sop-frontmatter-project-repo.md` — every
field explained in detail, including nesting rules, the `goal` privacy
guarantee, and how the Deadline/KPI math works.

## Architecture, in one diagram

```
projects/*.md, actions/*.md   (your source of truth — plain Markdown)
        ↓
scripts/build-data.js         (Node — reads frontmatter + git log)
        ↓
public/data-public.json        (static, safe to publish — no `goal` field ever)
netlify/functions/data-private.json  (only served after password check)
        ↓
src/main.js + src/style.css    (vanilla JS, no framework — routing via history.pushState)
```

No real backend, no database — the only server-side code is a couple of
small Netlify Functions that gate the private data behind a password and
(optionally) talk to DeepSeek/Google Calendar.

## Linking loose tasks to a project (`actions/`)

A project's real completion % includes checkboxes from any file in
`actions/` that links back to it with `[[project-slug]]` — see
`actions/homepage-nav-bugfixes.md` for a working example. Useful for
one-off tasks you don't want to promote into a full project file.

## Deploy

1. Push this repo to GitHub.
2. Netlify → **Add new site → Import an existing project**. Build
   command / publish directory are already set in `netlify.toml`.
3. Set the environment variable `PRIVATE_DASHBOARD_PASSWORD` (Site
   configuration → Environment variables) — required, or `/private`
   will show a config error.
4. Every `git push` triggers a rebuild — heatmap, %, and the project
   tree update from the latest commit automatically.

## Optional: AI task scheduling (`/schedule.html`)

Separate from the main dashboard, gated by its own password
(`DASHBOARD_PASSWORD`, different from `PRIVATE_DASHBOARD_PASSWORD`).
Type a sentence like "schedule my highest-priority tasks for tomorrow
9am-12pm", and it:

1. Runs `scripts/export-tasks.js` to gather every unchecked `- [ ]` task
   from your visible projects.
2. Sends that + your sentence to DeepSeek, which filters and assigns
   time slots.
3. Creates real events on your Google Calendar via OAuth.

Needs `DEEPSEEK_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`, `DASHBOARD_PASSWORD` as
Netlify environment variables. See comments at the top of
`netlify/functions/schedule-tasks.js` for the OAuth setup steps.

## Optional: weekly strategy report → Telegram

```bash
node scripts/weekly-report.js                          # generates a .md report
node --env-file=.env scripts/send-weekly-report.js      # sends it via Telegram
```

Answers: what does the data say, what's stuck, what to prioritize next
week and why, how far from your goals. `.github/workflows/weekly-report.yml`
runs this automatically every Monday morning — needs `TELEGRAM_BOT_TOKEN`
and `TELEGRAM_CHAT_ID` as GitHub Actions secrets (setup steps in the
comment block at the bottom of `scripts/send-weekly-report.js`).

## Syncing from a note-taking app (Obsidian, etc.)

This repo doesn't include any specific note-app integration — it just
reads whatever `.md` files land in `projects/`/`actions/`. If you keep
notes elsewhere (Obsidian, Logseq...), the simplest approach is a
GitHub Action in *that* repo that copies the relevant folders over on
push. Whatever mechanism you use, keep in mind: **if your source repo
is the source of truth and syncs one-way, don't hand-edit files directly
in this repo — they'll get overwritten on the next sync.** Edit at the
source.

## Structure

```
projects/                  # your projects — one .md file each
actions/                   # loose tasks, linked via [[wikilink]]
scripts/
├── build-data.js           # scans .md → data-public.json / data-private.json
├── export-tasks.js         # gathers open tasks → tasks.json (for AI scheduling)
├── weekly-report.js        # generates the weekly strategy report
└── send-weekly-report.js   # sends it via Telegram
netlify/functions/
├── private-data.js         # password-gates data-private.json
├── schedule-tasks.js       # AI scheduling: DeepSeek + Google Calendar
└── list-tasks.js           # read-only task list for /schedule.html
src/
├── main.js                 # UI, routing, filters, Report tab, heatmap
└── style.css                # theme (CSS variables at the top — easy to reskin)
public/
└── schedule.html             # AI scheduling UI, plain HTML/JS, not part of the Vite bundle
.github/workflows/
└── weekly-report.yml         # cron for the weekly Telegram report
sop-frontmatter-project-repo.md  # full frontmatter field reference
CONTEXT.md                    # architecture overview + known technical pitfalls
netlify.toml                 # build command, publish dir, redirects
```

## License

MIT — do whatever you want with it.
