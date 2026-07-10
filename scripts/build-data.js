// scripts/build-data.js
//
// Mô hình: 1 project = file trong projects/. Checklist thật của project KHÔNG
// chỉ nằm trong file đó, mà còn rải ở các file trong actions/ có [[wikilink]]
// trỏ tới project này, VÀ ở các project con có frontmatter `parent: "[[Tên Cha]]"`
// trỏ ngược lên project cha — gộp đệ quy, không giới hạn số tầng.
//
// Visibility: mỗi project có `visibility: public|private` trong frontmatter.
// Thiếu field này => coi là PRIVATE (an toàn hơn, phải khai báo rõ mới public).
//
// Priority: field `priority` trong frontmatter (số càng nhỏ = ưu tiên hiển thị
// càng cao, đứng trước). Project không có priority thì xếp sau cùng, và trong
// cùng 1 mức priority thì project có hoạt động gần đây nhất lên trước.
//
// Archive: project có tag "archive" trong frontmatter (vd tags: [project, archive])
// sẽ bị BỎ QUA HOÀN TOÀN, không xuất hiện ở cả data-public.json lẫn
// data-private.json. Vẫn nằm trong repo/vault bình thường, chỉ là không hiển
// thị trên dashboard web nữa.
// Nếu project cha có tag "archive", toàn bộ nhánh con cũng bị ẩn theo (đệ quy).
//
// Output:
//   public/data-public.json   -> chỉ project public (+ children public) — nằm
//                                 trong thư mục publish tĩnh, ai cũng tải được,
//                                 nên tuyệt đối không được chứa dữ liệu riêng tư.
//   netlify/functions/data-private.json -> TOÀN BỘ project (public + private),
//                                 nằm ngoài thư mục publish tĩnh, chỉ được đọc
//                                 bởi Netlify Function có kiểm tra mật khẩu.
//
// Ghi chú: mỗi file được đọc/parse trong try-catch riêng — nếu 1 file bị lỗi
// frontmatter (YAML sai cú pháp, ký tự null, v.v.) thì bị BỎ QUA (có log cảnh
// báo tên file), KHÔNG làm crash toàn bộ build. Xem log console sau khi build
// để biết file nào cần sửa.
//
// Chạy: node scripts/build-data.js  (npm run dev / npm run build tự gọi)

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import matter from "gray-matter";

import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT, "projects");
const ACTIONS_DIR = path.join(ROOT, "actions");
const PUBLIC_OUT_DIR = path.join(ROOT, "public");
const PUBLIC_OUT_FILE = path.join(PUBLIC_OUT_DIR, "data-public.json");
const PRIVATE_OUT_DIR = path.join(ROOT, "netlify", "functions");
const PRIVATE_OUT_FILE = path.join(PRIVATE_OUT_DIR, "data-private.json");

const CHECKLIST_RE = /^\s*-\s\[([ xX])\]\s+(.*)$/;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function listMarkdownFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

function isDoneStatus(status) {
  return String(status || "").trim().toLowerCase() === "done";
}

function resolveVisibility(frontmatter) {
  const v = String(frontmatter.visibility || "").trim().toLowerCase();
  return v === "public" ? "public" : "private";
}

function hasArchiveTag(frontmatter) {
  const tags = (frontmatter.tags || []).map((t) => String(t).toLowerCase());
  return tags.includes("archive");
}

// Lọc đệ quy: nếu project cha có tag "archive", toàn bộ nhánh con cũng bị ẩn.
// Hàm này chạy SAU loadRawProjects() (bước đó đã bỏ các project archive rồi),
// nên ở đây chỉ cần xử lý trường hợp con của project đã bị loại.
function pruneArchivedBranches(projects) {
  // Tập hợp tất cả matchKeys của các project có tag archive
  const archivedKeys = new Set();
  for (const p of projects) {
    if (hasArchiveTag(p.frontmatter)) {
      for (const k of p.matchKeys) archivedKeys.add(k);
    }
  }
  if (archivedKeys.size === 0) return projects;

  // Map nhanh filename -> project để tra cứu cha
  const byKey = new Map();
  for (const p of projects) {
    for (const k of p.matchKeys) byKey.set(k, p);
  }

  // Kiểm tra đệ quy: project này có phải hậu duệ của 1 project archive không?
  const visited = new Map();
  function isDescendantOfArchived(p) {
    if (visited.has(p.filename)) return visited.get(p.filename);
    if (!p.parentKey) { visited.set(p.filename, false); return false; }
    if (archivedKeys.has(p.parentKey)) { visited.set(p.filename, true); return true; }
    const parent = byKey.get(p.parentKey);
    const result = parent ? isDescendantOfArchived(parent) : false;
    visited.set(p.filename, result);
    return result;
  }

  return projects.filter((p) => !isDescendantOfArchived(p));
}

function effectiveChecklist(checklist, statusRaw) {
  if (!isDoneStatus(statusRaw)) return checklist;
  const total = checklist.total;
  return {
    items: checklist.items.map((i) => ({ ...i, done: true })),
    done: total,
    total,
    percent: 100,
  };
}

function parseChecklist(body) {
  const items = [];
  for (const rawLine of body.split("\n")) {
    const match = rawLine.match(CHECKLIST_RE);
    if (match) items.push({ done: match[1].toLowerCase() === "x", text: match[2].trim() });
  }
  const done = items.filter((i) => i.done).length;
  const total = items.length;
  return { items, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

function normalizeLinkTarget(raw) {
  let t = raw.split("|")[0].split("#")[0].trim();
  t = t.split("/").pop();
  return t.trim().toLowerCase();
}

function extractWikilinks(body) {
  const links = new Set();
  let m;
  while ((m = WIKILINK_RE.exec(body)) !== null) {
    links.add(normalizeLinkTarget(m[1]));
  }
  return links;
}

// goal chấp nhận cả "[[earn-money]]" (wikilink, tiện gõ trong Obsidian vì
// có autocomplete) lẫn "earn-money" (slug thường) — chuẩn hoá về cùng 1
// dạng để không bị tách thành 2 goal khác nhau do lệch cách gõ.
// YAML parse ngày dạng "2026-07-29" (không có ngoặc kép) thành JS Date
// object thay vì chuỗi — nếu không chuẩn hoá lại thành "YYYY-MM-DD", khi
// JSON.stringify sẽ ra "2026-07-29T00:00:00.000Z" và làm hỏng mọi phép
// tính ngày ở client (nối thêm "T00:00:00Z" vào chuỗi đã có sẵn giờ →
// chuỗi ngày không hợp lệ → NaN). Luôn ép field ngày về string qua hàm này.
function toDateString(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw.toISOString().slice(0, 10);
  return String(raw).slice(0, 10);
}

function normalizeGoal(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  WIKILINK_RE.lastIndex = 0;
  const m = WIKILINK_RE.exec(s);
  if (m) return normalizeLinkTarget(m[1]);
  return s.toLowerCase();
}

// Chấp nhận nhiều tên field cha-con khác nhau — quét lần lượt, dùng field
// đầu tiên có giá trị (ưu tiên theo thứ tự liệt kê).
const PARENT_FIELD_NAMES = ["parent", "parent-project", "parentProject", "project-parent"];

function extractParentLink(frontmatter) {
  let raw = null;
  for (const key of PARENT_FIELD_NAMES) {
    if (frontmatter[key]) {
      raw = frontmatter[key];
      break;
    }
  }
  if (!raw) return null;
  const s = String(raw);
  WIKILINK_RE.lastIndex = 0;
  const m = WIKILINK_RE.exec(s);
  if (m) return normalizeLinkTarget(m[1]);
  return s.trim().toLowerCase() || null;
}

function gitDatesForFile(absPath) {
  try {
    const out = execSync(
      `git log --follow --date=short --pretty=format:%ad -- "${absPath}"`,
      { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .trim();
    return out ? out.split("\n") : [];
  } catch {
    return [];
  }
}

// Biểu đồ "giờ nào trong ngày làm việc năng suất nhất" — cần GIỜ commit
// thật, không chỉ ngày. Chạy 1 lần cho toàn bộ projects/+actions/ (không
// chạy riêng từng file như gitDatesForFile, để tránh chậm build).
// %aI = author date chuẩn ISO 8601 kèm timezone offset gốc — nhưng vì
// commit có thể tới từ nhiều nguồn khác múi giờ (máy Hà giờ VN, hoặc
// GitHub Action chạy giờ UTC khi đồng bộ từ vault), KHÔNG thể tin trực
// tiếp offset ghi trong log. Parse ra thời điểm tuyệt đối (Date hiểu đúng
// offset), rồi tự quy đổi sang giờ Việt Nam (UTC+7, không có DST) thay vì
// dùng offset gốc — để "giờ" phản ánh đúng giờ VN dù commit tạo ra từ đâu.
function gitCommitHoursVN() {
  try {
    const out = execSync(`git log --pretty=format:%aI -- projects actions`, {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (!out) return [];
    return out.split("\n").map((iso) => {
      const d = new Date(iso);
      return (d.getUTCHours() + 7) % 24;
    });
  } catch {
    return [];
  }
}

function buildHourlyActivity() {
  const buckets = new Array(24).fill(0);
  for (const h of gitCommitHoursVN()) buckets[h] += 1;
  return buckets;
}

function fileTimestamps(absPath) {
  const stat = statSync(absPath);
  return { created: stat.birthtime.toISOString(), modified: stat.mtime.toISOString() };
}

function slugFromFilename(filename) {
  return filename
    .replace(/\.md$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function matchKeysFor(filename, frontmatter) {
  const baseName = filename.replace(/\.md$/, "").toLowerCase();
  const keys = new Set([baseName]);
  keys.add(slugFromFilename(filename)); // slug ASCII từ tên file gốc
  if (frontmatter.title) {
    const title = String(frontmatter.title);
    keys.add(title.toLowerCase());
    keys.add(slugFromFilename(title)); // slug ASCII từ title, vd "app-quan-ly-project"
  }
  for (const a of [...(frontmatter.alias || []), ...(frontmatter.aliases || [])]) {
    keys.add(String(a).toLowerCase());
    keys.add(slugFromFilename(String(a)));
  }
  return keys;
}

function loadActions() {
  const files = listMarkdownFiles(ACTIONS_DIR);
  const result = [];
  for (const filename of files) {
    const absPath = path.join(ACTIONS_DIR, filename);
    try {
      const raw = readFileSync(absPath, "utf-8");
      const { data: frontmatter, content } = matter(raw);
      result.push({
        filename,
        matchKeys: matchKeysFor(filename, frontmatter),
        checklist: effectiveChecklist(parseChecklist(content), frontmatter.status),
        links: extractWikilinks(raw),
        dates: gitDatesForFile(absPath),
      });
    } catch (err) {
      console.warn(`⚠️  Bỏ qua action lỗi frontmatter: actions/${filename} — ${err.message}`);
    }
  }
  return result;
}

function loadRawProjects() {
  const files = listMarkdownFiles(PROJECTS_DIR);
  const result = [];
  for (const filename of files) {
    const absPath = path.join(PROJECTS_DIR, filename);
    try {
      const raw = readFileSync(absPath, "utf-8");
      const { data: frontmatter, content } = matter(raw);

      if (hasArchiveTag(frontmatter)) {
        console.log(`⏭️  Bỏ qua project archive: projects/${filename}`);
        continue;
      }

      const ownChecklist = effectiveChecklist(parseChecklist(content), frontmatter.status);
      const ownDates = gitDatesForFile(absPath);
      const ts = fileTimestamps(absPath);
      result.push({
        filename,
        frontmatter,
        matchKeys: matchKeysFor(filename, frontmatter),
        parentKey: extractParentLink(frontmatter),
        ownChecklist,
        ownDates,
        ts,
        visibility: resolveVisibility(frontmatter),
      });
    } catch (err) {
      console.warn(`⚠️  Bỏ qua project lỗi frontmatter: projects/${filename} — ${err.message}`);
    }
  }
  return result;
}

function linkActionsToProject(project, allProjectsKnownKeys, actions) {
  const knownKeys = new Set(allProjectsKnownKeys);
  const included = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of actions) {
      if (included.includes(a)) continue;
      if ([...a.links].some((l) => knownKeys.has(l))) {
        included.push(a);
        for (const k of a.matchKeys) knownKeys.add(k);
        changed = true;
      }
    }
  }
  return included;
}

function buildProjectTree(rawProjects, actions) {
  const byKey = new Map();
  for (const p of rawProjects) {
    for (const k of p.matchKeys) byKey.set(k, p);
  }

  for (const p of rawProjects) {
    p.parent = null;
    if (p.parentKey) {
      const target = byKey.get(p.parentKey);
      if (target && target !== p) p.parent = target;
    }
    p.children = [];
  }
  for (const p of rawProjects) {
    if (p.parent) p.parent.children.push(p);
  }

  const nodeByFilename = new Map();
  for (const p of rawProjects) {
    const linkedActions = linkActionsToProject(p, p.matchKeys, actions);
    nodeByFilename.set(p.filename, { raw: p, linkedActions });
  }

  const effectiveCache = new Map();
  function computeEffective(p, visiting = new Set()) {
    if (effectiveCache.has(p.filename)) return effectiveCache.get(p.filename);
    if (visiting.has(p.filename)) {
      return { done: p.ownChecklist.done, total: p.ownChecklist.total, dates: new Set(p.ownDates) };
    }
    visiting.add(p.filename);

    const node = nodeByFilename.get(p.filename);
    let done = p.ownChecklist.done;
    let total = p.ownChecklist.total;
    const dates = new Set(p.ownDates);

    for (const a of node.linkedActions) {
      done += a.checklist.done;
      total += a.checklist.total;
      for (const d of a.dates) dates.add(d);
    }

    for (const child of p.children) {
      const childEff = computeEffective(child, visiting);
      done += childEff.done;
      total += childEff.total;
      for (const d of childEff.dates) dates.add(d);
    }

    visiting.delete(p.filename);
    const result = { done, total, dates };
    effectiveCache.set(p.filename, result);
    return result;
  }

  for (const p of rawProjects) computeEffective(p);

  const effectivePublicCache = new Map();
  function computeEffectivePublic(p, visiting = new Set()) {
    if (effectivePublicCache.has(p.filename)) return effectivePublicCache.get(p.filename);
    if (visiting.has(p.filename)) {
      return { done: p.ownChecklist.done, total: p.ownChecklist.total, dates: new Set(p.ownDates) };
    }
    visiting.add(p.filename);

    const node = nodeByFilename.get(p.filename);
    let done = p.ownChecklist.done;
    let total = p.ownChecklist.total;
    const dates = new Set(p.ownDates);

    for (const a of node.linkedActions) {
      done += a.checklist.done;
      total += a.checklist.total;
      for (const d of a.dates) dates.add(d);
    }

    for (const child of p.children) {
      if (child.visibility !== "public") continue;
      const childEff = computeEffectivePublic(child, visiting);
      done += childEff.done;
      total += childEff.total;
      for (const d of childEff.dates) dates.add(d);
    }

    visiting.delete(p.filename);
    const result = { done, total, dates };
    effectivePublicCache.set(p.filename, result);
    return result;
  }
  for (const p of rawProjects) computeEffectivePublic(p);

  return { nodeByFilename, effectiveCache, effectivePublicCache };
}

function toProjectDTO(p, nodeByFilename, effectiveCache, heatmap, { includeChildren = true, publicOnly = false } = {}) {
  const node = nodeByFilename.get(p.filename);
  const eff = effectiveCache.get(p.filename);
  const fm = p.frontmatter;
  const percent = eff.total === 0 ? (isDoneStatus(fm.status) ? 100 : 0) : Math.round((eff.done / eff.total) * 100);

  const projectActivity = {};
  for (const d of eff.dates) projectActivity[d] = (projectActivity[d] || 0) + 1;
  if (eff.dates.size === 0) projectActivity[p.ts.modified.slice(0, 10)] = 1;
  for (const [d, c] of Object.entries(projectActivity)) heatmap[d] = (heatmap[d] || 0) + c;

  const sortedDates = [...eff.dates].sort().reverse();

  const dto = {
    slug: slugFromFilename(p.filename),
    title: fm.title || p.filename.replace(/\.md$/, ""),
    description: fm.description || "",
    tags: fm.tags || [],
    status: isDoneStatus(fm.status) || percent === 100 ? "done" : "in-progress",
    visibility: p.visibility,
    priority: fm.priority ?? null,
    // goal chỉ hiện ở bản private — bạn dùng field này để track mục tiêu cá
    // nhân (vd "earn-money"), không muốn public thấy.
    goal: publicOnly ? null : normalizeGoal(fm.goal),
    isParent: p.children.length > 0,
    link: fm.link || null,
    repo: fm.repo || null,
    started: toDateString(fm.started) || p.ts.created.slice(0, 10),
    deadline: toDateString(fm.deadline),
    checklist: { items: p.ownChecklist.items, done: eff.done, total: eff.total, percent },
    linkedActions: node.linkedActions.map((a) => ({
      filename: a.filename.replace(/\.md$/, ""),
      done: a.checklist.done,
      total: a.checklist.total,
      items: a.checklist.items,
    })),
    lastActivity: sortedDates[0] || p.ts.modified.slice(0, 10),
    commitCount: eff.dates.size,
    activity: projectActivity,
  };

  if (includeChildren) {
    const kids = publicOnly ? p.children.filter((c) => c.visibility === "public") : p.children;
    dto.children = kids
      .map((c) =>
        toProjectDTO(c, nodeByFilename, effectiveCache, heatmap, { includeChildren: true, publicOnly })
      )
      .sort(byPriorityThenActivity);
  }

  return dto;
}

function byPriorityThenActivity(a, b) {
  const pa = a.priority == null || a.priority === "" ? Infinity : Number(a.priority);
  const pb = b.priority == null || b.priority === "" ? Infinity : Number(b.priority);
  if (pa !== pb) return pa - pb;
  return new Date(b.lastActivity) - new Date(a.lastActivity);
}

function main() {
  const actions = loadActions();
  // pruneArchivedBranches: ẩn cả nhánh con nếu cha có tag "archive"
  const rawProjects = pruneArchivedBranches(loadRawProjects());
  const { nodeByFilename, effectiveCache, effectivePublicCache } = buildProjectTree(rawProjects, actions);

  const roots = rawProjects.filter((p) => !p.parent);

  // Cảnh báo project khai parent/parent-project nhưng không khớp được project
  // nào — để biết ngay project nào bị "mồ côi" thay vì âm thầm hiện sai chỗ.
  const orphanParentProjects = rawProjects.filter((p) => p.parentKey && !p.parent);
  if (orphanParentProjects.length) {
    console.log("⚠️  Project khai parent nhưng KHÔNG khớp được project cha nào (kiểm tra tên/slug):");
    for (const p of orphanParentProjects) {
      console.log(`   - projects/${p.filename} → khai parent: "${p.parentKey}"`);
    }
  }

  // ---- Giờ nào trong ngày hoạt động nhiều nhất (giờ VN) — tính 1 lần,
  // dùng chung cho cả 2 bản, không phải dữ liệu riêng tư ----
  const hourlyActivity = buildHourlyActivity();

  // ---- FULL (private) ----
  const heatmapPrivate = {};
  const allProjectDTOs = roots.map((p) =>
    toProjectDTO(p, nodeByFilename, effectiveCache, heatmapPrivate, { publicOnly: false })
  );
  allProjectDTOs.sort(byPriorityThenActivity);

  mkdirSync(PRIVATE_OUT_DIR, { recursive: true });
  writeFileSync(
    PRIVATE_OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), projects: allProjectDTOs, heatmap: heatmapPrivate, hourlyActivity }, null, 2)
  );

  // ---- PUBLIC ----
  const heatmapPublic = {};
  const publicRoots = roots.filter((p) => p.visibility === "public");
  const publicProjectDTOs = publicRoots.map((p) =>
    toProjectDTO(p, nodeByFilename, effectivePublicCache, heatmapPublic, { publicOnly: true })
  );
  publicProjectDTOs.sort(byPriorityThenActivity);

  mkdirSync(PUBLIC_OUT_DIR, { recursive: true });
  writeFileSync(
    PUBLIC_OUT_FILE,
    JSON.stringify({ generatedAt: new Date().toISOString(), projects: publicProjectDTOs, heatmap: heatmapPublic, hourlyActivity }, null, 2)
  );

  const usedActionFiles = new Set(allProjectDTOs.flatMap((p) => p.linkedActions.map((a) => a.filename)));
  const orphanActions = actions.filter((a) => !usedActionFiles.has(a.filename.replace(/\.md$/, "")));

  console.log(
    `✓ data-private.json: ${allProjectDTOs.length} project gốc (${rawProjects.length - roots.length} project con), ${actions.length} action file.`
  );
  console.log(`✓ data-public.json: ${publicProjectDTOs.length} project gốc public.`);
  if (orphanActions.length) {
    console.log("  Action chưa khớp project nào (kiểm tra lại [[wikilink]] hoặc tên project):");
    for (const a of orphanActions) console.log(`   - ${a.filename}`);
  }
}

main();
