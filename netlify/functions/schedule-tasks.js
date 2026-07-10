// netlify/functions/schedule-tasks.js
//
// Bản "server" của scripts/schedule-tasks.js — dùng cho UI trên web thay vì
// chạy tay bằng dòng lệnh. Nhận POST { password, command }, kiểm tra mật khẩu,
// đọc scripts/output/tasks.json (được sinh ra NGAY TRONG build command của
// Netlify — xem netlify.toml — không commit vào repo, giống hệt cách
// data-private.json đã hoạt động), gửi cho DeepSeek để lọc + gán giờ, rồi tạo
// event thật trên Google Calendar.
//
// Biến môi trường cần có trên Netlify (Site settings → Environment variables):
//   DASHBOARD_PASSWORD
//   DEEPSEEK_API_KEY
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//   GOOGLE_CALENDAR_ID      (tùy chọn, mặc định "primary")
//
// Gọi từ trình duyệt:
//   POST /.netlify/functions/schedule-tasks
//   body: { "password": "...", "command": "lọc task dự án B, 9h-12h 10/07/2026" }
//
// Lưu ý: KHÔNG đặt tên biến là "__dirname" — Netlify tự bundle sẵn biến này
// cho ESM function, khai lại sẽ lỗi "Identifier '__dirname' has already been
// declared" (bug y hệt đã từng gặp ở private-data.js, xem comment file đó).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
// Từ netlify/functions/ đi lên 2 cấp là gốc repo, rồi vào scripts/output/tasks.json
const TASKS_JSON = path.join(currentDir, "..", "..", "scripts", "output", "tasks.json");

const TIMEZONE = "Asia/Ho_Chi_Minh";

function jsonResponse(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function loadTasks() {
  const raw = readFileSync(TASKS_JSON, "utf-8");
  return JSON.parse(raw);
}

async function askDeepSeekToFilterAndSchedule(tasks, userCommand, apiKey) {
  const systemPrompt = `
Bạn nhận một danh sách task (JSON) và một yêu cầu bằng tiếng Việt của người dùng.
Nhiệm vụ: lọc ra đúng những task khớp với yêu cầu, rồi phân bổ chúng vào khung
giờ mà người dùng chỉ định (ngày, giờ bắt đầu, giờ kết thúc).

QUY TẮC:
- Chỉ chọn task thực sự liên quan tới yêu cầu (dựa vào tên project, nội dung task).
- Chia đều thời gian trong khung giờ cho các task đã chọn, mỗi task tối thiểu 15 phút,
  không chồng giờ nhau, theo đúng thứ tự ưu tiên (priority nhỏ hơn xếp trước, giờ sớm hơn).
- Nếu số task nhiều hơn thời gian có thể chứa (mỗi task tối thiểu 15 phút), chỉ xếp
  đủ số lượng vừa khung giờ, bỏ bớt task có priority thấp hơn (số priority lớn hơn).
- Trả lời DUY NHẤT một mảng JSON, không kèm giải thích, không markdown code fence,
  không văn bản nào khác. Mỗi phần tử có dạng:
  {
    "task": "...",
    "project": "...",
    "start": "YYYY-MM-DDTHH:mm:00",
    "end": "YYYY-MM-DDTHH:mm:00"
  }
- Giờ theo định dạng 24h, KHÔNG kèm timezone offset (sẽ được gán timezone
  "${TIMEZONE}" riêng ở bước sau).
- Nếu không có task nào khớp yêu cầu, trả về mảng rỗng [].
`.trim();

  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Danh sách task:\n${JSON.stringify(tasks)}\n\nYêu cầu: ${userCommand}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek API lỗi (${response.status}): ${text}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content ?? "[]";
  const cleaned = raw.replace(/```json|```/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Không parse được JSON từ DeepSeek. Nội dung nhận được:\n${raw}`);
  }
}

async function getGoogleAccessToken() {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Không đổi được refresh token lấy access token: ${text}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function createCalendarEvent(accessToken, item) {
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        summary: `${item.task} (${item.project})`,
        description: `Tự động tạo từ dashboard UI\nProject: ${item.project}`,
        start: { dateTime: item.start, timeZone: TIMEZONE },
        end: { dateTime: item.end, timeZone: TIMEZONE },
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Tạo event thất bại cho task "${item.task}": ${text}`);
  }

  return response.json();
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

  const { password, command } = payload || {};

  if (!password || password !== expected) {
    return jsonResponse(401, { ok: false, error: "Sai mật khẩu." });
  }

  if (!command || !command.trim()) {
    return jsonResponse(400, { ok: false, error: "Thiếu câu lệnh (command)." });
  }

  try {
    const tasks = loadTasks();
    const scheduled = await askDeepSeekToFilterAndSchedule(
      tasks,
      command.trim(),
      process.env.DEEPSEEK_API_KEY
    );

    if (!Array.isArray(scheduled) || scheduled.length === 0) {
      return jsonResponse(200, {
        ok: true,
        scheduled: [],
        created: [],
        message: "Không có task nào khớp yêu cầu.",
      });
    }

    const accessToken = await getGoogleAccessToken();
    const created = [];
    const errors = [];

    for (const item of scheduled) {
      try {
        const event = await createCalendarEvent(accessToken, item);
        created.push({
          task: item.task,
          project: item.project,
          start: item.start,
          end: item.end,
          htmlLink: event.htmlLink,
        });
      } catch (err) {
        errors.push({ task: item.task, error: err.message });
      }
    }

    return jsonResponse(200, { ok: true, scheduled, created, errors });
  } catch (err) {
    return jsonResponse(500, { ok: false, error: err.message });
  }
};

export const config = {
  path: "/.netlify/functions/schedule-tasks",
};
