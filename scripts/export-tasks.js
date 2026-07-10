// scripts/export-tasks.js
//
// Gộp TOÀN BỘ task dạng "- [ ]" (chưa xong) từ mọi project đang hiển thị
// trên dashboard (đã loại project có tag "archive" + toàn bộ con/cháu của
// nó, giống hệt logic build-data.js) — cả project public lẫn private, vì
// đây là công cụ cá nhân để tự xếp lịch, không phải trang web công khai.
//
// Output:
//   scripts/output/tasks.json  -> mảng phẳng, dùng để feed thẳng vào
//                                  DeepSeek API (lọc bằng ngôn ngữ tự nhiên)
//                                  rồi từ kết quả gọi Google Calendar API.
//   scripts/output/TASKS.md    -> bản đọc bằng mắt, gom nhóm theo project.
//
// Chạy: node scripts/export-tasks.js

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROJECTS_DIR = path.join(ROOT, "projects");
const ACTIONS_DIR = path.join(ROOT, "actions");
const OUT_DIR = path.join(ROOT, "scripts", "output");
const OUT_JSON = path.join(OUT_DIR, "tasks.json");
const OUT_MD = path.join(OUT_DIR, "TASKS.md");

const CHECKLIST_RE = /^\s*-\s\[([ xX])\]\s+(.*)$/;
const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

function listMarkdownFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

function hasArchiveTag(frontmatter) {
  const tags = (frontmatter.tags || []).map((t) => String(t).toLowerCase());
  return tags.includes("archive");
}

function normalizeLinkTarget(raw) {
  let t = raw.split("|")[0].split("#")[0].trim();
  t = t.split("/").pop();
  return t.trim().toLowerCase();
}

function extractWikilinks(body) {
  const links = new Set();
  let m;
  while ((m = WIKILINK_RE.exec(body)) !== null) links.add(normalizeLinkTarget(m[1]));
  return links;
}

function extractParentLink(frontmatter) {
  const raw = frontmatter["parent-project"] ?? frontmatter.parent;
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  WIKILINK_RE.lastIndex = 0;
  const m = WIKILINK_RE.exec(s);
  if (m) return normalizeLinkTarget(m[1]);
  return s.toLowerCase();
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
  const keys = new Set([baseName, slugFromFilename(filename)]);
  if (frontmatter.title) keys.add(String(frontmatter.title).toLowerCase());
  for (const a of [...(frontmatter.alias || []), ...(frontmatter.aliases || [])]) {
    keys.add(String(a).toLowerCase());
  }
  return keys;
}

// Chỉ lấy các dòng CHƯA xong ("- [ ]"), bỏ qua dòng đã tick ("- [x]") —
// vì mục đích là xếp lịch việc còn phải làm, không cần task đã xong.
function extractUncheckedTasks(body) {
  const tasks = [];
  for (const line of body.split("\n")) {
    const m = line.match(CHECKLIST_RE);
   if (m && m[1] === " " && m[2].trim() !== "") tasks.push(m[2].trim());
  }
  return tasks;
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
        uncheckedTasks: extractUncheckedTasks(content),
        links: extractWikilinks(raw),
        frontmatter,
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
      result.push({
        filename,
        frontmatter,
        matchKeys: matchKeysFor(filename, frontmatter),
        parentKey: extractParentLink(frontmatter),
        uncheckedTasks: extractUncheckedTasks(content),
        archived: hasArchiveTag(frontmatter),
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

function collectArchivedSubtreeFilenames(rawProjects) {
  const excluded = new Set();
  function markSubtree(p) {
    if (excluded.has(p.filename)) return;
    excluded.add(p.filename);
    for (const child of p.children) markSubtree(child);
  }
  for (const p of rawProjects) if (p.archived) markSubtree(p);
  return excluded;
}

function main() {
  const actions = loadActions();
  const rawProjects = loadRawProjects();

  const byKey = new Map();
  for (const p of rawProjects) for (const k of p.matchKeys) byKey.set(k, p);

  for (const p of rawProjects) {
    p.parent = null;
    if (p.parentKey) {
      const target = byKey.get(p.parentKey);
      if (target && target !== p) p.parent = target;
    }
    p.children = [];
  }
  for (const p of rawProjects) if (p.parent) p.parent.children.push(p);

  const archivedExcluded = collectArchivedSubtreeFilenames(rawProjects);
  const visibleProjects = rawProjects.filter((p) => !archivedExcluded.has(p.filename));

  const rows = [];

  for (const p of visibleProjects) {
    const title = p.frontmatter.title || p.filename.replace(/\.md$/, "");
    const slug = slugFromFilename(p.filename);
    const priority = p.frontmatter.priority ?? null;
    const goal = p.frontmatter.goal ?? null;

    for (const task of p.uncheckedTasks) {
      rows.push({
        task,
        project: title,
        projectSlug: slug,
        priority,
        goal,
        source: `projects/${p.filename}`,
      });
    }

    const linkedActions = linkActionsToProject(p, p.matchKeys, actions);
    for (const a of linkedActions) {
      for (const task of a.uncheckedTasks) {
        rows.push({
          task,
          project: title,
          projectSlug: slug,
          priority,
          goal,
          source: `actions/${a.filename}`,
        });
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });

  writeFileSync(OUT_JSON, JSON.stringify(rows, null, 2));

  // ---- Bản .md đọc bằng mắt, gom nhóm theo project ----
  const byProject = new Map();
  for (const r of rows) {
    if (!byProject.has(r.projectSlug)) byProject.set(r.projectSlug, { title: r.project, priority: r.priority, tasks: [] });
    byProject.get(r.projectSlug).tasks.push(r.task);
  }

  const sortedProjects = [...byProject.values()].sort((a, b) => {
    const pa = a.priority == null ? Infinity : Number(a.priority);
    const pb = b.priority == null ? Infinity : Number(b.priority);
    return pa - pb;
  });

  let md = `# Danh sách task chưa xong — tổng hợp toàn bộ project\n\n`;
  md += `_Tự động tạo từ \`scripts/export-tasks.js\` — tổng ${rows.length} task, ${sortedProjects.length} project._\n\n`;
  for (const proj of sortedProjects) {
    md += `## ${proj.title}${proj.priority != null ? ` (P${proj.priority})` : ""}\n\n`;
    for (const t of proj.tasks) md += `- [ ] ${t}\n`;
    md += `\n`;
  }

  writeFileSync(OUT_MD, md);

  console.log(`✓ Tổng ${rows.length} task chưa xong, gộp từ ${sortedProjects.length} project.`);
  console.log(`✓ Đã ghi: scripts/output/tasks.json`);
  console.log(`✓ Đã ghi: scripts/output/TASKS.md`);
  console.log(`  → Các project bị loại: ${[...archivedExcluded].join(", ")}`);
  if (archivedExcluded.size) {
    console.log(`  (Đã bỏ qua ${archivedExcluded.size} project archive + con/cháu, không tính vào danh sách này.)`);
  }
}

main();
