// scripts/weekly-report.js
//
// Sinh báo cáo chiến lược hàng tuần từ data-private.json (đã có sẵn qua
// build-data.js) — trả lời 4 câu: xu hướng số liệu nói gì, đang tắc ở
// đâu, tuần tới ưu tiên gì + vì sao, còn cách mục tiêu bao xa.
//
// Không phải dashboard mới — chỉ đọc lại đúng logic đã có ở tab Report
// trên web (Streak, Velocity, Stale, Forecast, Goal allocation, KPI),
// port sang Node để chạy định kỳ (cron / GitHub Action / chạy tay) và
// xuất ra 1 file .md gửi đi được (email, Telegram...).
//
// Output: scripts/output/weekly-report-YYYY-MM-DD.md (không commit git,
// giống tasks.json — sinh mới mỗi lần chạy).
//
// Chạy: node scripts/weekly-report.js

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_FILE = path.join(ROOT, "netlify", "functions", "data-private.json");
const OUT_DIR = path.join(ROOT, "scripts", "output");

function todayVN() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function flattenProjects(projects) {
  const out = [];
  for (const p of projects) {
    out.push(p);
    if (p.children?.length) out.push(...flattenProjects(p.children));
  }
  return out;
}

// ── Streak (y hệt logic main.js) ───────────────────────────────────────
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

// ── Velocity — vài tuần gần nhất, so sánh trực tiếp ──────────────────
function weeklyActivityBuckets(heatmap, weeksBack = 8) {
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const buckets = new Array(weeksBack).fill(0);
  for (const [d, c] of Object.entries(heatmap)) {
    const daysAgo = Math.floor((today - new Date(d + "T00:00:00Z")) / 86400000);
    const week = Math.floor(daysAgo / 7);
    if (week >= 0 && week < weeksBack) buckets[weeksBack - 1 - week] += c;
  }
  return buckets;
}

// ── Stale but important ──────────────────────────────────────────────
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

// ── Forecast completion ─────────────────────────────────────────────
function forecastCompletion(p) {
  const { done, total } = p.checklist;
  if (p.status === "done" || total === 0 || done === 0 || p.commitCount === 0) return null;
  const started = new Date(p.started + "T00:00:00Z");
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const calendarDaysSoFar = Math.max(1, Math.round((today - started) / 86400000));
  const density = p.commitCount / calendarDaysSoFar;
  if (density <= 0) return null;
  const rate = done / p.commitCount;
  if (rate <= 0) return null;
  const remaining = total - done;
  const activeDaysNeeded = remaining / rate;
  const calendarDaysNeeded = Math.ceil(activeDaysNeeded / density);
  const forecastDate = new Date(today.getTime() + calendarDaysNeeded * 86400000);
  return { forecastDate: forecastDate.toISOString().slice(0, 10), calendarDaysNeeded, remaining };
}

// ── Goal allocation ──────────────────────────────────────────────────
function goalAllocation(projects) {
  const byGoal = new Map();
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
      goal, activeDays: v.activeDays, doneItems: v.doneItems,
      effortPct: Math.round((v.activeDays / totalActive) * 100),
      donePct: Math.round((v.doneItems / totalDone) * 100),
    }))
    .sort((a, b) => b.activeDays - a.activeDays);
}

// ── Deadline / KPI ───────────────────────────────────────────────────
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
  const expectedPct = totalSpan > 0 ? Math.min(100, Math.max(0, Math.round((elapsed / totalSpan) * 100))) : 100;
  let status;
  if (daysLeft < 0) status = "overdue";
  else if (actualPct < expectedPct - 15 || (daysLeft <= 7 && actualPct < 90)) status = "at-risk";
  else status = "on-track";
  return { status, daysLeft, actualPct, expectedPct };
}

// ── Build report ─────────────────────────────────────────────────────
function buildReport() {
  const data = JSON.parse(readFileSync(DATA_FILE, "utf-8"));
  const projects = data.projects;
  const heatmap = data.heatmap;

  const streaks = computeStreaks(heatmap);
  const weekly = weeklyActivityBuckets(heatmap, 8);
  const thisWeek = weekly[weekly.length - 1];
  const lastWeek = weekly[weekly.length - 2] || 0;
  const avg6wk = Math.round(weekly.slice(0, 6).reduce((a, b) => a + b, 0) / 6);
  const trendPct = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  const stale = staleImportantProjects(projects);

  const flat = flattenProjects(projects).filter((p) => p.status !== "done");
  const forecasts = flat
    .map((p) => ({ p, f: forecastCompletion(p) }))
    .filter((x) => x.f)
    .sort((a, b) => a.f.calendarDaysNeeded - b.f.calendarDaysNeeded);

  const goals = goalAllocation(projects);

  const kpiRows = flattenProjects(projects)
    .map((p) => ({ p, k: kpiStatus(p) }))
    .filter((x) => x.k)
    .sort((a, b) => {
      const order = { overdue: 0, "at-risk": 1, "on-track": 2, done: 3 };
      if (order[a.k.status] !== order[b.k.status]) return order[a.k.status] - order[b.k.status];
      return a.k.daysLeft - b.k.daysLeft;
    });
  const overdue = kpiRows.filter((r) => r.k.status === "overdue");
  const atRisk = kpiRows.filter((r) => r.k.status === "at-risk");

  const nextWeekFocus = [
    ...overdue.map((r) => ({ title: r.p.title, why: `Quá hạn ${Math.abs(r.k.daysLeft)} ngày (deadline ${r.p.deadline})` })),
    ...atRisk.map((r) => ({ title: r.p.title, why: `Deadline còn ${r.k.daysLeft} ngày, đang ${r.k.actualPct}% (kỳ vọng ${r.k.expectedPct}%)` })),
    ...stale.slice(0, 3).map((p) => ({ title: p.title, why: `Priority P${p.priority}, im lìm ${p.daysSince} ngày` })),
  ].slice(0, 6);

  const totalOpenTasks = flat.reduce((s, p) => s + (p.checklist.total - p.checklist.done), 0);
  const totalProjects = flat.length;

  const date = todayVN();

  let md = `# Báo cáo chiến lược tuần — ${date}\n\n`;
  md += `_Tự động tạo từ \`scripts/weekly-report.js\`, dựa trên dữ liệu thật (git activity + checklist), không phải tự đánh giá._\n\n`;
  md += `---\n\n`;

  md += `## 1. Số liệu nói gì\n\n`;
  md += `- **Streak hiện tại:** ${streaks.current} ngày liên tục (kỷ lục: ${streaks.longest} ngày)\n`;
  md += `- **Hoạt động tuần này:** ${thisWeek} (tuần trước: ${lastWeek}`;
  md += trendPct === null ? `)\n` : `, ${trendPct >= 0 ? "tăng" : "giảm"} ${Math.abs(trendPct)}%)\n`;
  md += `- **Trung bình 6 tuần gần nhất:** ${avg6wk}/tuần — `;
  md += thisWeek < avg6wk * 0.7
    ? `tuần này **thấp hơn rõ rệt** so với nhịp thường, đáng để hỏi vì sao.\n`
    : thisWeek > avg6wk * 1.3
    ? `tuần này **cao hơn rõ rệt** so với nhịp thường.\n`
    : `tuần này ở mức bình thường.\n`;
  md += `- **${totalProjects} project đang mở, còn ${totalOpenTasks} task chưa xong.**\n\n`;

  md += `## 2. Đang tắc ở đâu\n\n`;
  if (stale.length) {
    md += `${stale.length} project có priority nhưng ≥14 ngày không động tới:\n\n`;
    for (const p of stale.slice(0, 8)) {
      md += `- **${p.title}** (P${p.priority}) — im lìm ${p.daysSince} ngày, đang ${p.checklist.percent}%\n`;
    }
    md += `\n`;
  } else {
    md += `Không có project ưu tiên nào bị bỏ rơi tuần này — tốt.\n\n`;
  }
  if (overdue.length) {
    md += `**${overdue.length} project đã quá hạn deadline:**\n\n`;
    for (const r of overdue) md += `- **${r.p.title}** — quá hạn ${Math.abs(r.k.daysLeft)} ngày (deadline ${r.p.deadline}), đang ${r.k.actualPct}%\n`;
    md += `\n`;
  }

  md += `## 3. Ưu tiên tuần tới, và vì sao\n\n`;
  if (nextWeekFocus.length) {
    nextWeekFocus.forEach((f, i) => { md += `${i + 1}. **${f.title}** — ${f.why}\n`; });
  } else {
    md += `Không có tín hiệu khẩn cấp nào — tuần tới có thể chọn tự do theo priority thường.\n`;
  }
  md += `\n`;

  md += `## 4. Còn cách mục tiêu bao xa\n\n`;
  if (goals.length) {
    md += `Phân bổ effort + công việc hoàn thành theo goal:\n\n`;
    md += `| Goal | % effort | % việc hoàn thành |\n|---|---|---|\n`;
    for (const g of goals) md += `| ${g.goal} | ${g.effortPct}% | ${g.donePct}% |\n`;
    md += `\n`;
  } else {
    md += `Chưa có project nào gắn field \`goal\` — không đo được phân bổ theo mục tiêu tuần này.\n\n`;
  }
  if (kpiRows.length) {
    md += `Deadline đang theo dõi: ${overdue.length} quá hạn, ${atRisk.length} cần chú ý, ${kpiRows.filter(r=>r.k.status==="on-track").length} đúng tiến độ.\n\n`;
  }
  if (forecasts.length) {
    md += `Ước tính ngày hoàn thành gần nhất (dựa trên tốc độ hiện tại, không phải cam kết):\n\n`;
    for (const { p, f } of forecasts.slice(0, 5)) {
      md += `- **${p.title}**: còn ${f.remaining} việc, ước ~${f.forecastDate}\n`;
    }
    md += `\n`;
  }

  md += `---\n\n_Xem chi tiết đầy đủ tại tab \`/report\` trên dashboard (bản private)._\n`;

  const summary = {
    streakCurrent: streaks.current,
    streakLongest: streaks.longest,
    thisWeek, lastWeek, trendPct,
    totalProjects, totalOpenTasks,
    overdueCount: overdue.length,
    atRiskCount: atRisk.length,
    topFocus: nextWeekFocus.slice(0, 3).map((f) => f.title),
  };

  return { md, date, summary };
}

function main() {
  const { md, date } = buildReport();
  mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, `weekly-report-${date}.md`);
  writeFileSync(outFile, md);
  console.log(`✓ Đã tạo: scripts/output/weekly-report-${date}.md`);
  console.log(md);
}

// Chỉ tự chạy khi gọi trực tiếp "node scripts/weekly-report.js" — khi file
// khác import { buildReport } thì KHÔNG tự chạy main() (tránh side-effect
// ghi file 2 lần khi send-weekly-report.js gọi lại logic này).
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { buildReport };
