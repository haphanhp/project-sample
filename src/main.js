// src/main.js

const app = document.getElementById("app");
let DATA = null;
let VIEW_MODE = "public";
let activeTags = new Set();
let activeStatus = "all";
let activeProgress = "all";   // "all" | "0-25" | "26-50" | "51-75" | "76-99" | "done"
let activePriority = "all";   // "all" | "1" | "2" | "3" | "4" | "none"
let heatmapView = "week";

// ─── Per-project activity index (cho heatmap tổng biết ngày nào thuộc
// project nào) ────────────────────────────────────────────────────────────
// project.activity (từ build-data.js) đã có sẵn per-project date→count —
// chỉ cần gộp lại theo ngày, kèm tên project, để heatmap tổng ở trang chủ
// biết "ngày này hoạt động chủ yếu thuộc project nào".
let ACTIVITY_INDEX = {}; // { "2026-07-08": [{ slug, title, count }, ...] sắp xếp giảm dần }

function flattenProjects(projects) {
  const out = [];
  for (const p of projects) {
    out.push(p);
    if (p.children && p.children.length) out.push(...flattenProjects(p.children));
  }
  return out;
}

function buildActivityIndex(projects) {
  const byDate = {}; // date -> { slug -> {title, count} }
  for (const p of flattenProjects(projects)) {
    for (const [date, count] of Object.entries(p.activity || {})) {
      if (!byDate[date]) byDate[date] = {};
      byDate[date][p.slug] = { title: p.title, count: (byDate[date][p.slug]?.count || 0) + count };
    }
  }
  const index = {};
  for (const [date, bySlug] of Object.entries(byDate)) {
    index[date] = Object.entries(bySlug)
      .map(([slug, v]) => ({ slug, title: v.title, count: v.count }))
      .sort((a, b) => b.count - a.count);
  }
  return index;
}

// Top project theo tổng hoạt động trong 1 tập ngày cho trước (dùng cho
// "leaderboard" dưới heatmap — chỉ tính trong đúng khung thời gian đang xem).
function topProjectsForDates(dateKeys) {
  const totals = new Map(); // slug -> { title, days: Set, count }
  for (const key of dateKeys) {
    const entries = ACTIVITY_INDEX[key];
    if (!entries) continue;
    for (const e of entries) {
      const cur = totals.get(e.slug) || { title: e.title, days: 0, count: 0 };
      cur.days += 1;
      cur.count += e.count;
      totals.set(e.slug, cur);
    }
  }
  return [...totals.entries()]
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

// ─── Goal → color mapping ────────────────────────────────────────────────────
// Each unique goal value gets a stable border color.
const GOAL_COLORS = [
  "#2BADA0", // teal
  "#7B9BC4", // lavender
  "#3A7A4A", // forest
  "#C17A3A", // amber
  "#9B6BC4", // purple
  "#C44A4A", // coral
  "#4A8FC4", // sky
  "#C4A43A", // gold
];
const goalColorCache = new Map();
let goalColorIndex = 0;

function goalColor(goal) {
  if (!goal) return "var(--lavender)";
  if (!goalColorCache.has(goal)) {
    goalColorCache.set(goal, GOAL_COLORS[goalColorIndex % GOAL_COLORS.length]);
    goalColorIndex++;
  }
  return goalColorCache.get(goal);
}

// Pre-seed colors from all projects so colors are stable regardless of filter
function seedGoalColors(projects) {
  for (const p of projects) {
    if (p.goal) goalColor(p.goal);
    if (p.children) seedGoalColors(p.children);
  }
}

// ─── Data loading ────────────────────────────────────────────────────────────
async function loadPublicData() {
  const res = await fetch("/data-public.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load data-public.json — have you run `npm run data`?");
  return res.json();
}

async function loadPrivateData(password) {
  const res = await fetch("/.netlify/functions/private-data", {
    headers: { "x-dashboard-key": password },
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("Wrong password.");
  if (!res.ok) throw new Error("Could not load private data.");
  return res.json();
}

// ─── Heatmap helpers ─────────────────────────────────────────────────────────
function dateKey(d) { return d.toISOString().slice(0, 10); }

function levelFor(count) {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count === 2) return 2;
  if (count <= 4) return 3;
  return 4;
}

function buildHeatmapCells(heatmap, weeks = 26) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (weeks * 7 - 1));
  start.setDate(start.getDate() - start.getDay());
  const cells = [];
  const cursor = new Date(start);
  while (cursor <= today) {
    const key = dateKey(cursor);
    const count = heatmap[key] || 0;
    cells.push({ date: key, count, level: levelFor(count) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return cells;
}

function projectBreakdownText(dateKeys) {
  const top = topProjectsForDates(dateKeys);
  if (!top.length) return "";
  return " — " + top.map((t) => `${t.title} (${t.count})`).join(", ");
}

function renderHeatmapWeek(heatmap, weeks = 26, perProject = false) {
  const cells = buildHeatmapCells(heatmap, weeks);
  const html = cells.map((c) => {
    const breakdown = perProject ? projectBreakdownText([c.date]) : "";
    return `<div class="heatmap-cell" data-level="${c.level}" title="${c.date} · ${c.count} activity${breakdown}"></div>`;
  }).join("");
  return `<div class="heatmap-wrap"><div class="heatmap-grid">${html}</div></div>`;
}

function renderHeatmapMonth(heatmap, perProject = false) {
  const today = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const year = d.getFullYear(), month = d.getMonth();
    const label = d.toLocaleDateString("vi-VN", { month: "short", year: "2-digit" });
    let total = 0;
    const days = new Date(year, month + 1, 0).getDate();
    const dateKeys = [];
    for (let day = 1; day <= days; day++) {
      const key = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      dateKeys.push(key);
      total += heatmap[key] || 0;
    }
    months.push({ label, total, dateKeys, level: levelFor(Math.ceil(total / 4)) });
  }
  const html = months.map((m) => {
    const breakdown = perProject ? projectBreakdownText(m.dateKeys) : "";
    return `
    <div class="heatmap-period-col">
      <div class="heatmap-cell heatmap-cell-lg" data-level="${m.level}" title="${m.label} · ${m.total} activity${breakdown}"></div>
      <div class="heatmap-period-label">${m.label}</div>
    </div>`;
  }).join("");
  return `<div class="heatmap-period-grid">${html}</div>`;
}

function renderHeatmapQuarter(heatmap, perProject = false) {
  const today = new Date();
  const currentQ = Math.floor(today.getMonth() / 3);
  const quarters = [];
  for (let i = 7; i >= 0; i--) {
    let q = currentQ - i, year = today.getFullYear();
    while (q < 0) { q += 4; year--; }
    let total = 0;
    const dateKeys = [];
    for (let m = 0; m < 3; m++) {
      const month = q * 3 + m;
      const y = year + Math.floor(month / 12), mo = month % 12;
      const days = new Date(y, mo + 1, 0).getDate();
      for (let day = 1; day <= days; day++) {
        const key = `${y}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
        dateKeys.push(key);
        total += heatmap[key] || 0;
      }
    }
    quarters.push({ label: `Q${q+1} ${year}`, total, dateKeys, level: levelFor(Math.ceil(total / 12)) });
  }
  const html = quarters.map((q) => {
    const breakdown = perProject ? projectBreakdownText(q.dateKeys) : "";
    return `
    <div class="heatmap-period-col">
      <div class="heatmap-cell heatmap-cell-lg" data-level="${q.level}" title="${q.label} · ${q.total} activity${breakdown}"></div>
      <div class="heatmap-period-label">${q.label}</div>
    </div>`;
  }).join("");
  return `<div class="heatmap-period-grid">${html}</div>`;
}

function visibleDateKeysFor(view, weeks) {
  if (view === "week") return buildHeatmapCells({}, weeks).map((c) => c.date);
  const today = new Date();
  const keys = [];
  if (view === "month") {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      for (let day = 1; day <= days; day++) {
        keys.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
      }
    }
  } else { // quarter
    const currentQ = Math.floor(today.getMonth() / 3);
    for (let i = 7; i >= 0; i--) {
      let q = currentQ - i, year = today.getFullYear();
      while (q < 0) { q += 4; year--; }
      for (let m = 0; m < 3; m++) {
        const month = q * 3 + m;
        const y = year + Math.floor(month / 12), mo = month % 12;
        const days = new Date(y, mo + 1, 0).getDate();
        for (let day = 1; day <= days; day++) {
          keys.push(`${y}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`);
        }
      }
    }
  }
  return keys;
}

function renderTopProjects(weeks) {
  const dateKeys = visibleDateKeysFor(heatmapView, weeks);
  const top = topProjectsForDates(dateKeys);
  if (!top.length) return "";
  const max = top[0].count;
  const rows = top.map((t) => `
    <a class="top-project-row" href="/projects/${t.slug}" data-route>
      <span class="top-project-name">${escapeHtml(t.title)}</span>
      <div class="top-project-bar-track"><div class="top-project-bar" style="width:${Math.max(6, Math.round((t.count/max)*100))}%"></div></div>
      <span class="top-project-count">${t.days}d · ${t.count}×</span>
    </a>`).join("");
  return `<div class="top-projects"><div class="top-projects-label">Where the effort went (this period)</div>${rows}</div>`;
}

// "Ngày" — không phải lịch theo ngày, mà là PHÂN BỐ THEO GIỜ TRONG NGÀY
// (0h-23h), gộp toàn bộ lịch sử — để biết giờ nào hay làm việc nhất. Dữ
// liệu tính 1 lần lúc build (DATA.hourlyActivity, giờ đã quy đổi đúng giờ
// VN), không phụ thuộc tuần/tháng/quý đang xem.
function renderHeatmapDay() {
  const buckets = DATA?.hourlyActivity || new Array(24).fill(0);
  const max = Math.max(1, ...buckets);
  const peakHour = buckets.indexOf(Math.max(...buckets));
  const bars = buckets.map((v, h) => `
    <div class="velocity-bar" style="height:${Math.max(3, Math.round((v / max) * 60))}px" title="${String(h).padStart(2,"0")}:00 — ${v} activity"></div>
  `).join("");
  const labels = buckets.map((_, h) => h % 3 === 0 ? `<span>${String(h).padStart(2,"0")}h</span>` : `<span></span>`).join("");
  return `
    <div class="velocity-bars" style="align-items:flex-end">${bars}</div>
    <div class="hour-labels">${labels}</div>
    <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:6px">
      Peak: ${String(peakHour).padStart(2,"0")}:00 giờ VN — gộp toàn bộ lịch sử hoạt động
    </div>`;
}

function renderHeatmap(heatmap, weeks = 26, { showSwitcher = true, perProject = false } = {}) {
  const totalDays = Object.keys(heatmap).length;
  const totalCommits = Object.values(heatmap).reduce((a, b) => a + b, 0);
  let chartHtml = "", label = "";
  if (heatmapView === "week") { chartHtml = renderHeatmapWeek(heatmap, weeks, perProject); label = `last ${weeks} weeks`; }
  else if (heatmapView === "month") { chartHtml = renderHeatmapMonth(heatmap, perProject); label = "last 12 months"; }
  else if (heatmapView === "quarter") { chartHtml = renderHeatmapQuarter(heatmap, perProject); label = "last 8 quarters"; }
  else { chartHtml = renderHeatmapDay(); label = "by hour of day (all-time)"; }

  const switcher = showSwitcher ? `
    <div class="heatmap-switcher">
      <button class="heatmap-tab ${heatmapView==="week"?"active":""}" data-heatmap-view="week">Week</button>
      <button class="heatmap-tab ${heatmapView==="month"?"active":""}" data-heatmap-view="month">Month</button>
      <button class="heatmap-tab ${heatmapView==="quarter"?"active":""}" data-heatmap-view="quarter">Quarter</button>
      ${perProject ? `<button class="heatmap-tab ${heatmapView==="day"?"active":""}" data-heatmap-view="day">Day</button>` : ""}
    </div>` : "";

  return `
    <div class="heatmap-header">
      <span class="heatmap-view-label">${label}</span>
      ${switcher}
    </div>
    ${chartHtml}
    ${heatmapView === "day" ? "" : `
    <div class="heatmap-legend">
      <span>${totalDays} days · ${totalCommits} commits</span>
      <span style="margin-left:auto">less</span>
      <div class="heatmap-cell" data-level="0" style="width:10px;height:10px"></div>
      <div class="heatmap-cell" data-level="1" style="width:10px;height:10px"></div>
      <div class="heatmap-cell" data-level="2" style="width:10px;height:10px"></div>
      <div class="heatmap-cell" data-level="3" style="width:10px;height:10px"></div>
      <div class="heatmap-cell" data-level="4" style="width:10px;height:10px"></div>
      <span>more</span>
    </div>`}
    ${perProject && heatmapView !== "day" ? renderTopProjects(weeks) : ""}`;
}

function attachHeatmapSwitcher(heatmap, weeks = 26, perProject = false) {
  document.querySelectorAll("[data-heatmap-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      heatmapView = btn.dataset.heatmapView;
      const section = document.querySelector(".heatmap-section");
      if (section) {
        const w = section.dataset.detail === "true" ? 12 : weeks;
        section.querySelector(".heatmap-inner").innerHTML = renderHeatmap(heatmap, w, { showSwitcher: true, perProject });
        attachHeatmapSwitcher(heatmap, weeks, perProject);
      }
    });
  });
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function renderChecklist(checklist, { limit = null } = {}) {
  const items = limit ? checklist.items.slice(0, limit) : checklist.items;
  const remaining = checklist.items.length - items.length;
  const html = items.map((item) => `
    <li class="checklist-item ${item.done ? "done" : ""}">
      <span class="box">[${item.done ? "x" : " "}]</span>
      <span>${escapeHtml(item.text)}</span>
    </li>`).join("");
  const more = remaining > 0 ? `<div class="checklist-more">+ ${remaining} more items…</div>` : "";
  return `<ul class="checklist">${html}</ul>${more}`;
}

function visibilityBadge(project) {
  if (VIEW_MODE !== "private") return "";
  return project.visibility === "private" ? `<span class="badge-private">private</span>` : "";
}

const EARTH_LIGHT_RGB = [176, 137, 104];
const EARTH_DARK_RGB  = [74, 47, 20];
function earthToneColor(percent) {
  const t = Math.max(0, Math.min(100, percent)) / 100;
  const [r,g,b] = EARTH_LIGHT_RGB.map((s, i) => Math.round(s + (EARTH_DARK_RGB[i] - s) * t));
  return `rgb(${r},${g},${b})`;
}
function stampAttrs(percent) {
  if (percent >= 100) return `data-tier="100"`;
  return `style="color:${earthToneColor(percent)}"`;
}

// ─── Project card ─────────────────────────────────────────────────────────────
function renderProjectCard(project) {
  const links = [];
  if (project.link) links.push(`<a href="${project.link}" target="_blank" rel="noopener">Live demo</a>`);
  if (project.repo) links.push(`<a href="${project.repo}" target="_blank" rel="noopener">Repo</a>`);

  const borderColor = goalColor(project.goal);
  const priorityBadge = project.priority != null
    ? `<span class="badge-priority" title="Priority">P${project.priority}</span>`
    : "";

  return `
    <article class="project-card" style="border-top-color:${borderColor}">
      <a class="card-link-overlay" href="/projects/${project.slug}" data-route aria-label="View details ${escapeHtml(project.title)}"></a>
      <div class="card-top">
        <div style="flex:1;min-width:0">
          <h3 class="card-title">${escapeHtml(project.title)} ${visibilityBadge(project)} ${priorityBadge}</h3>
          <p class="card-desc">${escapeHtml(project.description)}</p>
        </div>
        <div class="stamp" ${stampAttrs(project.checklist.percent)}>${project.checklist.percent}%</div>
      </div>

      ${project.goal ? `<div class="card-goal" style="color:${borderColor}">⬡ ${escapeHtml(project.goal)}</div>` : ""}

      ${project.tags.length ? `<div class="card-meta">${project.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>` : ""}

      ${project.isParent ? `<div class="card-meta"><span class="tag tag-parent">${project.children.length} sub-projects</span></div>` : ""}

      ${renderChecklist(project.checklist, { limit: 5 })}

      <div class="card-footer">
        <span>updated ${project.lastActivity}</span>
        <div class="card-links">${links.join("")}</div>
      </div>
    </article>`;
}

// ─── Filter helpers ───────────────────────────────────────────────────────────
function allTags(projects) {
  const set = new Set();
  for (const p of projects) for (const t of p.tags) set.add(t);
  return [...set].sort();
}

function allPriorities(projects) {
  const set = new Set();
  for (const p of projects) {
    if (p.priority != null) set.add(String(p.priority));
  }
  return [...set].sort((a, b) => Number(a) - Number(b));
}

function allGoals(projects) {
  const set = new Set();
  for (const p of projects) if (p.goal) set.add(p.goal);
  return [...set].sort();
}

function progressBucket(percent, status) {
  if (status === "done" || percent >= 100) return "done";
  if (percent >= 76) return "76-99";
  if (percent >= 51) return "51-75";
  if (percent >= 26) return "26-50";
  return "0-25";
}

function filteredProjects(projects) {
  return projects.filter((p) => {
    const pct = p.checklist.percent;
    const statusOk = activeStatus === "all" || p.status === activeStatus;
    const tagsOk = activeTags.size === 0 || p.tags.some((t) => activeTags.has(t));
    const progressOk = activeProgress === "all" || progressBucket(pct, p.status) === activeProgress;
    const priorityOk = activePriority === "all"
      || (activePriority === "none" && p.priority == null)
      || String(p.priority) === activePriority;
    return statusOk && tagsOk && progressOk && priorityOk;
  });
}

// ─── Filter bar ───────────────────────────────────────────────────────────────
function renderFilterBar(projects) {
  const tags = allTags(projects);
  const priorities = allPriorities(projects);
  const goals = allGoals(projects);

  const chip = (val, label, dataset, active) =>
    `<button class="chip ${active ? "active" : ""}" ${dataset}="${escapeHtml(val)}">${label}</button>`;

  // Progress chips với màu tương ứng mức hoàn thành
  const progressChips = [
    { val: "all",   label: "All" },
    { val: "0-25",  label: "0–25%" },
    { val: "26-50", label: "26–50%" },
    { val: "51-75", label: "51–75%" },
    { val: "76-99", label: "76–99%" },
    { val: "done",  label: "Done ✓" },
  ].map(({ val, label }) =>
    `<button class="chip progress-chip ${activeProgress === val ? "active" : ""}" data-progress="${val}">${label}</button>`
  ).join("");

  const priorityChips = [
    `<button class="chip priority-chip ${activePriority === "all" ? "active" : ""}" data-priority="all">All P</button>`,
    ...priorities.map((p) =>
      `<button class="chip priority-chip ${activePriority === p ? "active" : ""}" data-priority="${p}">P${p}</button>`
    ),
    `<button class="chip priority-chip ${activePriority === "none" ? "active" : ""}" data-priority="none">Unset</button>`,
  ].join("");

  const goalChips = goals.map((g) => {
    const color = goalColor(g);
    const isActive = activeTags.has(`goal:${g}`);
    return `<button class="chip goal-chip ${isActive ? "active" : ""}" data-goal="${escapeHtml(g)}"
      style="${isActive ? `background:${color};border-color:${color};color:var(--ink)` : `border-color:${color};color:${color}`}">
      ${escapeHtml(g)}
    </button>`;
  }).join("");

  const tagChips = tags.map((t) =>
    `<button class="chip tag-chip ${activeTags.has(t) ? "active" : ""}" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</button>`
  ).join("");

  return `
    <div class="filter-bar">
      <div class="filter-group filter-group-label">
        <span class="filter-label">Progress</span>
        ${progressChips}
      </div>
      <div class="filter-group filter-group-label">
        <span class="filter-label">Priority</span>
        ${priorityChips}
      </div>
      ${goals.length ? `<div class="filter-group filter-group-label"><span class="filter-label">Goal</span>${goalChips}</div>` : ""}
      ${tags.length ? `<div class="filter-group filter-group-label"><span class="filter-label">Tag</span>${tagChips}</div>` : ""}
    </div>`;
}

function attachFilterEvents(projects) {
  document.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => { activeStatus = btn.dataset.status; renderDashboard(projects, DATA.heatmap); });
  });
  document.querySelectorAll("[data-progress]").forEach((btn) => {
    btn.addEventListener("click", () => { activeProgress = btn.dataset.progress; renderDashboard(projects, DATA.heatmap); });
  });
  document.querySelectorAll("[data-priority]").forEach((btn) => {
    btn.addEventListener("click", () => { activePriority = btn.dataset.priority; renderDashboard(projects, DATA.heatmap); });
  });
  document.querySelectorAll("[data-goal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = `goal:${btn.dataset.goal}`;
      if (activeTags.has(key)) activeTags.delete(key); else activeTags.add(key);
      renderDashboard(projects, DATA.heatmap);
    });
  });
  document.querySelectorAll("[data-tag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tag = btn.dataset.tag;
      if (activeTags.has(tag)) activeTags.delete(tag); else activeTags.add(tag);
      renderDashboard(projects, DATA.heatmap);
    });
  });
}

function attachRouteLinks() {
  document.querySelectorAll("[data-route]").forEach((el) => {
    el.addEventListener("click", (e) => { e.preventDefault(); navigate(el.getAttribute("href")); });
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function renderDashboard(projects, heatmap) {
  // filteredProjects cần xét goal filter riêng
  const visible = projects.filter((p) => {
    const pct = p.checklist.percent;
    const statusOk = activeStatus === "all" || p.status === activeStatus;
    const progressOk = activeProgress === "all" || progressBucket(pct, p.status) === activeProgress;
    const priorityOk = activePriority === "all"
      || (activePriority === "none" && p.priority == null)
      || String(p.priority) === activePriority;
    const goalKeys = [...activeTags].filter((t) => t.startsWith("goal:")).map((t) => t.slice(5));
    const tagKeys  = [...activeTags].filter((t) => !t.startsWith("goal:"));
    const goalOk  = goalKeys.length === 0 || goalKeys.includes(p.goal);
    const tagsOk  = tagKeys.length  === 0 || p.tags.some((t) => tagKeys.includes(t));
    return statusOk && progressOk && priorityOk && goalOk && tagsOk;
  });

  const doneCount = projects.filter((p) => p.status === "done").length;
  const avgPercent = projects.length
    ? Math.round(projects.reduce((s, p) => s + p.checklist.percent, 0) / projects.length) : 0;

  const modeSwitch = VIEW_MODE === "public"
    ? `<a href="/private" data-route class="mode-switch">View full (private) →</a>`
    : `<a href="/" data-route class="mode-switch">← View public version</a>`;
  const reportLink = VIEW_MODE === "private"
    ? `<a href="/report" data-route class="mode-switch" style="margin-left:12px">Report →</a>` : "";

  app.innerHTML = `
    <header class="masthead">
      <div>
        <h1 class="masthead-title masthead-title-glow">project<span>_</span>log</h1>
        <div class="masthead-sub">real checklist · real completion % · updated from git log</div>
      </div>
      <div class="masthead-stats">
        <div class="masthead-stat"><span class="num">${projects.length}</span><span class="label">Projects</span></div>
        <div class="masthead-stat"><span class="num">${doneCount}</span><span class="label">Done</span></div>
        <div class="masthead-stat"><span class="num">${avgPercent}%</span><span class="label">Average</span></div>
      </div>
    </header>

    ${modeSwitch}${reportLink}

    <section class="heatmap-section">
      <div class="section-label">Activity</div>
      <div class="heatmap-inner">${renderHeatmap(heatmap, 26, { showSwitcher: true, perProject: true })}</div>
    </section>

    <section>
      <div class="section-label">Projects</div>
      ${renderFilterBar(projects)}
      ${visible.length
        ? `<div class="project-grid">${visible.map(renderProjectCard).join("")}</div>`
        : `<div class="empty-state">No projects match the filter.</div>`}
    </section>`;

  attachFilterEvents(projects);
  attachRouteLinks();
  attachHeatmapSwitcher(heatmap, 26, true);
}

// ─── Detail page ──────────────────────────────────────────────────────────────
function renderChildProjectsSection(project) {
  if (!project.children || project.children.length === 0) return "";
  return `
    <section>
      <div class="section-label">Project con (${project.children.length})</div>
      <div class="project-grid">${project.children.map(renderProjectCard).join("")}</div>
    </section>`;
}

function renderProjectDetail(project) {
  if (!project) {
    app.innerHTML = `<a href="/" data-route class="back-link">← Back</a><div class="empty-state">Project not found.</div>`;
    attachRouteLinks();
    return;
  }

  const links = [];
  if (project.link) links.push(`<a href="${project.link}" target="_blank" rel="noopener">Live demo →</a>`);
  if (project.repo) links.push(`<a href="${project.repo}" target="_blank" rel="noopener">Repo →</a>`);

  const borderColor = goalColor(project.goal);

  app.innerHTML = `
    <a href="/" data-route class="back-link">← Back to dashboard</a>

    <header class="detail-header" style="border-left:4px solid ${borderColor};padding-left:16px">
      <div>
        <h1 class="detail-title">${escapeHtml(project.title)} ${visibilityBadge(project)}</h1>
        <p class="detail-desc">${escapeHtml(project.description)}</p>
        <div class="card-meta">
          ${project.goal ? `<span class="tag" style="border:1px solid ${borderColor};color:${borderColor}">⬡ ${escapeHtml(project.goal)}</span>` : ""}
          ${project.priority != null ? `<span class="badge-priority">P${project.priority}</span>` : ""}
          ${project.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}
        </div>
      </div>
      <div class="stamp stamp-lg" ${stampAttrs(project.checklist.percent)}>${project.checklist.percent}%</div>
    </header>

    <div class="detail-links">${links.join("")}</div>

    <section class="heatmap-section" data-detail="true">
      <div class="section-label">Activity (including sub-projects)</div>
      <div class="heatmap-inner">${renderHeatmap(project.activity || {}, 12, { showSwitcher: true })}</div>
    </section>

    <section>
      <div class="section-label">Checklist (${project.checklist.items.filter((i)=>i.done).length}/${project.checklist.items.length})</div>
      <div class="detail-card">${renderChecklist(project.checklist)}</div>
    </section>

    ${project.linkedActions.length ? `
      <section>
        <div class="section-label">Linked actions (${project.linkedActions.length})</div>
        ${project.linkedActions.map((a) => `
          <div class="detail-card action-card">
            <div class="action-card-title">${escapeHtml(a.filename)} <span class="action-card-ratio">${a.done}/${a.total}</span></div>
            ${renderChecklist({ items: a.items })}
          </div>`).join("")}
      </section>` : ""}

    ${renderChildProjectsSection(project)}

    <div class="detail-footer">
      Started ${project.started} · Updated ${project.lastActivity} · ${project.commitCount} active days
    </div>`;

  attachRouteLinks();
  attachHeatmapSwitcher(project.activity || {}, 12);
}

function findProjectBySlug(projects, slug) {
  for (const p of projects) {
    if (p.slug === slug) return p;
    const found = findProjectBySlug(p.children || [], slug);
    if (found) return found;
  }
  return null;
}

// ─── Password gate ────────────────────────────────────────────────────────────
function renderPasswordGate(errorMsg = "") {
  app.innerHTML = `
    <a href="/" data-route class="back-link">← Back to public version</a>
    <header class="masthead">
      <div>
        <h1 class="masthead-title masthead-title-glow">project<span>_</span>log <span style="font-size:14px">(private)</span></h1>
        <div class="masthead-sub">Enter password to view all projects.</div>
      </div>
    </header>
    <div class="detail-card" style="max-width:360px">
      <form id="password-form">
        <input type="password" id="password-input" placeholder="Password" autofocus
          style="width:100%;padding:8px;margin-bottom:8px;box-sizing:border-box"/>
        <button type="submit" style="width:100%;padding:8px">View</button>
        ${errorMsg ? `<div style="color:var(--teal);margin-top:8px">${escapeHtml(errorMsg)}</div>` : ""}
      </form>
    </div>`;
  attachRouteLinks();
  document.getElementById("password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pw = document.getElementById("password-input").value;
    try {
      const data = await loadPrivateData(pw);
      DATA = data; VIEW_MODE = "private";
      sessionStorage.setItem("dashboardKey", pw);
      seedGoalColors(DATA.projects);
      ACTIVITY_INDEX = buildActivityIndex(DATA.projects);
      if (location.pathname === "/report") renderReport();
      else renderDashboard(DATA.projects, DATA.heatmap);
    } catch (err) { renderPasswordGate(err.message); }
  });
}

// ─── Report tab — chỉ số phân tích chuyên sâu (chỉ ở bản private, vì có
// dùng field goal) ─────────────────────────────────────────────────────────

// Streak: chuỗi ngày hoạt động liên tục (dùng heatmap tổng, gộp mọi project).
function computeStreaks(heatmap) {
  const dates = Object.keys(heatmap).filter((d) => heatmap[d] > 0).sort();
  if (!dates.length) return { current: 0, longest: 0, lastActive: null };
  let longest = 1, run = 1;
  for (let i = 1; i < dates.length; i++) {
    const diff = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
    run = diff === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const lastActive = new Date(dates[dates.length - 1] + "T00:00:00Z");
  const gapToToday = Math.round((today - lastActive) / 86400000);
  let current = 0;
  if (gapToToday <= 1) {
    current = 1;
    for (let i = dates.length - 1; i > 0; i--) {
      const diff = Math.round((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000);
      if (diff === 1) current++; else break;
    }
  }
  return { current, longest, lastActive: dates[dates.length - 1] };
}

// Velocity: tổng hoạt động mỗi tuần trong N tuần gần nhất, để thấy xu hướng
// tăng/giảm — dùng activity (ngày có hoạt động) làm proxy, vì hệ thống
// không lưu lịch sử % hoàn thành theo thời gian, chỉ lưu ngày nào có hoạt động.
function weeklyActivityBuckets(heatmap, weeksBack = 12) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const buckets = new Array(weeksBack).fill(0);
  for (const [d, c] of Object.entries(heatmap)) {
    const daysAgo = Math.floor((today - new Date(d + "T00:00:00Z")) / 86400000);
    const week = Math.floor(daysAgo / 7);
    if (week >= 0 && week < weeksBack) buckets[weeksBack - 1 - week] += c;
  }
  return buckets; // index 0 = xa nhất, cuối = tuần này
}

// Dự đoán ngày hoàn thành: dựa trên tốc độ hoàn thành trung bình mỗi ngày
// hoạt động (done/commitCount), quy đổi ra ngày lịch dựa trên mật độ hoạt
// động thật của project (activeDays/calendarDays kể từ lúc bắt đầu). Chỉ là
// ƯỚC TÍNH thô — không phải cam kết, cần đủ dữ liệu lịch sử mới đáng tin.
function forecastCompletion(p) {
  const { done, total } = p.checklist;
  if (p.status === "done" || total === 0 || done === 0 || p.commitCount === 0) return null;
  const started = new Date(p.started + "T00:00:00Z");
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const calendarDaysSoFar = Math.max(1, Math.round((today - started) / 86400000));
  const density = p.commitCount / calendarDaysSoFar; // tỉ lệ ngày có hoạt động
  if (density <= 0) return null;
  const rate = done / p.commitCount; // item hoàn thành / ngày hoạt động
  if (rate <= 0) return null;
  const remaining = total - done;
  const activeDaysNeeded = remaining / rate;
  const calendarDaysNeeded = Math.ceil(activeDaysNeeded / density);
  const forecastDate = new Date(today.getTime() + calendarDaysNeeded * 86400000);
  return { forecastDate: forecastDate.toISOString().slice(0, 10), calendarDaysNeeded, remaining };
}

// Project bị bỏ rơi: có priority (đang được coi là quan trọng), chưa done,
// nhưng lâu không có hoạt động.
function staleImportantProjects(projects, thresholdDays = 14) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  return flattenProjects(projects)
    .filter((p) => p.priority != null && p.status !== "done")
    .map((p) => {
      const last = new Date(p.lastActivity + "T00:00:00Z");
      const daysSince = Math.round((today - last) / 86400000);
      return { ...p, daysSince };
    })
    .filter((p) => p.daysSince >= thresholdDays)
    .sort((a, b) => b.daysSince - a.daysSince);
}

// Phân bổ effort + công việc hoàn thành theo goal — trả lời đúng câu "công
// việc hoàn thành đang đóng góp bao nhiêu % cho từng mục tiêu".
function goalAllocation(projects) {
  const byGoal = new Map(); // goal -> { activeDays, doneItems }
  for (const p of flattenProjects(projects)) {
    if (!p.goal) continue;
    const cur = byGoal.get(p.goal) || { activeDays: 0, doneItems: 0 };
    cur.activeDays += p.commitCount || 0;
    cur.doneItems += p.checklist.done || 0;
    byGoal.set(p.goal, cur);
  }
  const totalActive = [...byGoal.values()].reduce((s, v) => s + v.activeDays, 0) || 1;
  const totalDone = [...byGoal.values()].reduce((s, v) => s + v.doneItems, 0) || 1;
  return [...byGoal.entries()]
    .map(([goal, v]) => ({
      goal,
      activeDays: v.activeDays,
      doneItems: v.doneItems,
      effortPct: Math.round((v.activeDays / totalActive) * 100),
      donePct: Math.round((v.doneItems / totalDone) * 100),
    }))
    .sort((a, b) => b.activeDays - a.activeDays);
}

function barRow(labelHtml, pct, rightText) {
  return `
    <div class="report-bar-row">
      <span class="report-bar-label">${labelHtml}</span>
      <div class="top-project-bar-track"><div class="top-project-bar" style="width:${Math.max(3, pct)}%"></div></div>
      <span class="report-bar-value">${rightText}</span>
    </div>`;
}

// Deadline / KPI: so % hoàn thành thật với % kỳ vọng theo tiến độ thời gian
// (đường thẳng từ started → deadline). Không nhập tay trạng thái — tính từ
// checklist thật để khỏi lệch với thực tế.
function kpiStatus(p) {
  if (!p.deadline) return null;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const started = new Date(p.started + "T00:00:00Z");
  const deadline = new Date(p.deadline + "T00:00:00Z");
  const daysLeft = Math.round((deadline - today) / 86400000);
  const actualPct = p.checklist.percent;

  if (p.status === "done") return { status: "done", daysLeft, actualPct, expectedPct: 100 };

  const totalSpan = deadline - started;
  const elapsed = today - started;
  const expectedPct = totalSpan > 0
    ? Math.min(100, Math.max(0, Math.round((elapsed / totalSpan) * 100)))
    : 100;

  let status;
  if (daysLeft < 0) status = "overdue";
  else if (actualPct < expectedPct - 15 || (daysLeft <= 7 && actualPct < 90)) status = "at-risk";
  else status = "on-track";

  return { status, daysLeft, actualPct, expectedPct };
}

function kpiBadge(status) {
  const map = {
    "on-track": { label: "On track", color: "var(--teal)" },
    "at-risk": { label: "At risk", color: "#d9a441" },
    "overdue": { label: "Overdue", color: "#c85a4a" },
    "done": { label: "Done", color: "var(--text-muted)" },
  };
  const m = map[status];
  return `<span style="font-family:var(--font-mono);font-size:10px;padding:2px 8px;border-radius:99px;border:1px solid ${m.color};color:${m.color}">${m.label}</span>`;
}

function renderReport() {
  const projects = DATA.projects;
  const heatmap = DATA.heatmap;
  const streaks = computeStreaks(heatmap);
  const weekly = weeklyActivityBuckets(heatmap, 12);
  const maxWeek = Math.max(1, ...weekly);
  const thisWeek = weekly[weekly.length - 1], lastWeek = weekly[weekly.length - 2] || 0;
  const trend = thisWeek === lastWeek ? "→" : thisWeek > lastWeek ? "↑" : "↓";

  const flat = flattenProjects(projects).filter((p) => p.status !== "done");
  const forecasts = flat
    .map((p) => ({ p, f: forecastCompletion(p) }))
    .filter((x) => x.f)
    .sort((a, b) => a.f.calendarDaysNeeded - b.f.calendarDaysNeeded);

  const stale = staleImportantProjects(projects);
  const goals = goalAllocation(projects);

  const kpiRows = flattenProjects(projects)
    .map((p) => ({ p, k: kpiStatus(p) }))
    .filter((x) => x.k)
    .sort((a, b) => {
      const order = { overdue: 0, "at-risk": 1, "on-track": 2, done: 3 };
      if (order[a.k.status] !== order[b.k.status]) return order[a.k.status] - order[b.k.status];
      return a.k.daysLeft - b.k.daysLeft;
    });

  app.innerHTML = `
    <header class="masthead">
      <div>
        <h1 class="masthead-title masthead-title-glow">project<span>_</span>log <span style="font-size:14px">— report</span></h1>
        <div class="masthead-sub">chỉ số phân tích, tính từ dữ liệu thật (git activity + checklist) — không phải cam kết, chỉ để tham khảo xu hướng</div>
      </div>
      <a href="/private" data-route class="mode-switch">← Back to dashboard</a>
    </header>

    <section class="report-grid">

      <div class="report-card">
        <div class="section-label">Streak</div>
        <div class="masthead-stats" style="margin-top:6px">
          <div class="masthead-stat"><span class="num">${streaks.current}</span><span class="label">Current streak (days)</span></div>
          <div class="masthead-stat"><span class="num">${streaks.longest}</span><span class="label">Longest streak (days)</span></div>
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:8px">
          Last active: ${streaks.lastActive || "—"}
        </div>
      </div>

      <div class="report-card">
        <div class="section-label">Velocity — activity per week (last 12 weeks) ${trend}</div>
        <div class="velocity-bars">
          ${weekly.map((v) => `<div class="velocity-bar" style="height:${Math.max(3, Math.round((v / maxWeek) * 60))}px" title="${v} activity"></div>`).join("")}
        </div>
        <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);margin-top:6px">
          This week: ${thisWeek} · Last week: ${lastWeek}
        </div>
      </div>

      <div class="report-card" style="grid-column:1/-1">
        <div class="section-label">Deadline / KPI</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:6px">
          % thật vs % kỳ vọng theo tiến độ thời gian còn lại tới deadline —
          không phải bạn tự đánh giá, tính từ checklist thật.
        </div>
        ${kpiRows.length ? kpiRows.map(({ p, k }) => `
          <a href="/projects/${p.slug}" data-route class="top-project-row" style="grid-template-columns:1fr 70px 100px 90px">
            <span class="top-project-name">${escapeHtml(p.title)}</span>
            <span class="top-project-count">${k.actualPct}% / ${k.expectedPct}%</span>
            <span class="top-project-count">${k.status === "overdue" ? `${Math.abs(k.daysLeft)}d overdue` : k.status === "done" ? p.deadline : `${k.daysLeft}d left`}</span>
            ${kpiBadge(k.status)}
          </a>`).join("") : `<div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">Chưa có project nào khai <code>deadline</code>.</div>`}
      </div>

      <div class="report-card" style="grid-column:1/-1">
        <div class="section-label">Estimated completion date (rough estimate, based on current pace)</div>
        ${forecasts.length ? forecasts.slice(0, 12).map(({ p, f }) => `
          <a href="/projects/${p.slug}" data-route class="top-project-row" style="grid-template-columns:1fr 90px 100px">
            <span class="top-project-name">${escapeHtml(p.title)} <span style="color:var(--text-muted)">(${p.checklist.percent}%)</span></span>
            <span class="top-project-count">${f.remaining} left</span>
            <span class="top-project-count">~${f.forecastDate}</span>
          </a>`).join("") : `<div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">Not enough activity history yet to estimate.</div>`}
      </div>

      <div class="report-card" style="grid-column:1/-1">
        <div class="section-label">Stale but important — priority set, not done, no activity ≥14 days</div>
        ${stale.length ? stale.slice(0, 12).map((p) => `
          <a href="/projects/${p.slug}" data-route class="top-project-row" style="grid-template-columns:1fr 60px 100px">
            <span class="top-project-name">${escapeHtml(p.title)}</span>
            <span class="top-project-count">P${p.priority}</span>
            <span class="top-project-count">${p.daysSince}d idle</span>
          </a>`).join("") : `<div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">Nothing stale right now — good.</div>`}
      </div>

      <div class="report-card" style="grid-column:1/-1">
        <div class="section-label">Goal allocation — where effort & finished work go</div>
        ${goals.length ? `
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:6px">bar = % active days · số bên phải = % completed items</div>
          ${goals.map((g) => barRow(escapeHtml(g.goal), g.effortPct, `${g.effortPct}% effort · ${g.donePct}% done`)).join("")}
        ` : `<div style="font-family:var(--font-mono);font-size:12px;color:var(--text-muted)">Chưa có project nào gắn field <code>goal</code>.</div>`}
      </div>

    </section>`;
  attachRouteLinks();
}
function navigate(path) { history.pushState({}, "", path); route(); }

async function switchToPublicView() {
  const data = await loadPublicData();
  DATA = data; VIEW_MODE = "public";
  sessionStorage.removeItem("dashboardKey");
}

async function route() {
  const path = location.pathname;
  const detailMatch = path.match(/^\/projects\/(.+)$/);

  if ((path === "/private" || path === "/report") && VIEW_MODE !== "private") {
    const savedKey = sessionStorage.getItem("dashboardKey");
    if (savedKey) {
      try {
        const data = await loadPrivateData(savedKey);
        DATA = data; VIEW_MODE = "private";
        seedGoalColors(DATA.projects);
        ACTIVITY_INDEX = buildActivityIndex(DATA.projects);
        if (path === "/report") renderReport();
        else renderDashboard(DATA.projects, DATA.heatmap);
        return;
      } catch { sessionStorage.removeItem("dashboardKey"); }
    }
    renderPasswordGate();
    return;
  }

  if (path === "/" && VIEW_MODE === "private") {
    try { await switchToPublicView(); }
    catch (err) { app.innerHTML = `<div class="empty-state">${err.message}</div>`; return; }
  }

  if (path === "/report") {
    if (VIEW_MODE !== "private") { renderPasswordGate(); return; }
    renderReport();
  } else if (detailMatch) {
    renderProjectDetail(findProjectBySlug(DATA.projects, detailMatch[1]));
  } else {
    renderDashboard(DATA.projects, DATA.heatmap);
  }
}

window.addEventListener("popstate", route);

loadPublicData().then((data) => {
  DATA = data;
  seedGoalColors(DATA.projects);
      ACTIVITY_INDEX = buildActivityIndex(DATA.projects);
  route();
}).catch((err) => {
  app.innerHTML = `<div class="empty-state">${err.message}</div>`;
  console.error(err);
});
