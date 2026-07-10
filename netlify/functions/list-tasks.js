// netlify/functions/list-tasks.js
//
// Trả về toàn bộ nội dung scripts/output/tasks.json (được sinh ra ngay trong
// build command của Netlify, không commit vào repo — xem netlify.toml) dưới
// dạng JSON, gộp nhóm theo project, để UI hiển thị thành tab "Danh sách task".
//
// Gọi từ trình duyệt:
//   POST /.netlify/functions/list-tasks
//   body: { "password": "..." }

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const TASKS_JSON = path.join(currentDir, "..", "..", "scripts", "output", "tasks.json");

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default async (request) => {
  if (request.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Chỉ nhận method POST." });
  }

  const expected = process.env.DASHBOARD_PASSWORD;
  if (!expected) {
    return jsonResponse(500, { ok: false, error: "Server chưa cấu hình DASHBOARD_PASSWORD." });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse(400, { ok: false, error: "Body không phải JSON hợp lệ." });
  }

  const { password } = payload || {};
  if (!password || password !== expected) {
    return jsonResponse(401, { ok: false, error: "Sai mật khẩu." });
  }

  try {
    const raw = readFileSync(TASKS_JSON, "utf-8");
    const tasks = JSON.parse(raw);

    const byProject = new Map();
    for (const t of tasks) {
      if (!byProject.has(t.projectSlug)) {
        byProject.set(t.projectSlug, {
          project: t.project,
          priority: t.priority,
          goal: t.goal,
          tasks: [],
        });
      }
      byProject.get(t.projectSlug).tasks.push(t.task);
    }

    const groups = [...byProject.values()].sort((a, b) => {
      const pa = a.priority == null ? Infinity : Number(a.priority);
      const pb = b.priority == null ? Infinity : Number(b.priority);
      return pa - pb;
    });

    return jsonResponse(200, { ok: true, total: tasks.length, groups, raw: tasks });
  } catch (err) {
    return jsonResponse(500, {
      ok: false,
      error: `Không đọc được tasks.json: ${err.message}`,
    });
  }
};

export const config = {
  path: "/.netlify/functions/list-tasks",
};
