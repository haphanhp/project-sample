// scripts/send-weekly-report.js
//
// Gửi báo cáo chiến lược tuần (đã tạo bởi scripts/weekly-report.js) qua
// Telegram Bot API — 1 tin nhắn tóm tắt nhanh + 1 file .md đính kèm đọc đầy đủ.
//
// Setup 1 lần (không cần OAuth, không cần duyệt):
//   1. Trên Telegram, chat với @BotFather → gõ /newbot → đặt tên bot →
//      nhận về TELEGRAM_BOT_TOKEN (dạng "123456789:AAF...").
//   2. Nhắn bất kỳ tin gì cho bot vừa tạo (để bot "biết" chat với bạn).
//   3. Lấy TELEGRAM_CHAT_ID bằng cách mở trình duyệt:
//        https://api.telegram.org/bot<TOKEN>/getUpdates
//      tìm số ở "chat":{"id": ...} trong JSON trả về — đó là chat_id của bạn.
//   4. Thêm 2 biến vào .env:
//        TELEGRAM_BOT_TOKEN=...
//        TELEGRAM_CHAT_ID=...
//
// Chạy: node scripts/weekly-report.js && node --env-file=.env scripts/send-weekly-report.js

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "scripts", "output");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Thiếu biến môi trường ${name}. Xem hướng dẫn setup ở đầu file này.`);
    process.exit(1);
  }
  return v;
}

// Lấy file weekly-report-*.md mới nhất trong scripts/output/ (không cần
// nhớ đúng ngày, luôn lấy bản mới sinh gần đây nhất).
function findLatestReport() {
  const files = readdirSync(OUT_DIR).filter((f) => /^weekly-report-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  if (!files.length) {
    console.error(`❌ Không tìm thấy weekly-report-*.md trong scripts/output/. Chạy "node scripts/weekly-report.js" trước.`);
    process.exit(1);
  }
  files.sort();
  return path.join(OUT_DIR, files[files.length - 1]);
}

// Tóm tắt 3-4 dòng đầu (phần "Số liệu nói gì") để hiện ngay trong tin nhắn
// đẩy thông báo — không cần mở file mới thấy được điểm chính.
function extractSummary(md) {
  const section = md.split("## 2.")[0].split("## 1. Số liệu nói gì")[1] || "";
  return section.trim().slice(0, 600);
}

// Telegram parse_mode "Markdown" (bản legacy) chỉ hiểu *in đậm* (1 dấu
// sao) — báo cáo gốc dùng **in đậm** (2 dấu sao, chuẩn markdown thường).
// Không đổi sẽ hiện sai (dư dấu **) hoặc Telegram trả lỗi 400 do không
// parse được entity. Đổi **x** -> *x*, và loại bỏ ký tự `#`/`` ` `` không
// cần thiết trong tin nhắn ngắn (giữ nguyên trong file .md đính kèm).
function toTelegramMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#+\s*/gm, "")
    .replace(/`/g, "");
}

async function sendTelegramMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) throw new Error(`sendMessage lỗi: ${await res.text()}`);
  return res.json();
}

async function sendTelegramDocument(token, chatId, filePath, caption) {
  const fileBuffer = readFileSync(filePath);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", caption);
  form.append("document", new Blob([fileBuffer], { type: "text/markdown" }), path.basename(filePath));

  const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(`sendDocument lỗi: ${await res.text()}`);
  return res.json();
}

async function main() {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const reportPath = findLatestReport();
  const md = readFileSync(reportPath, "utf-8");
  const dateMatch = path.basename(reportPath).match(/(\d{4}-\d{2}-\d{2})/);
  const date = dateMatch ? dateMatch[1] : "";

  const summary = toTelegramMarkdown(extractSummary(md));
  const messageText = `📊 *Báo cáo chiến lược tuần — ${date}*\n\n${summary}\n\n_File đầy đủ đính kèm bên dưới._`;

  console.log("Đang gửi tin nhắn tóm tắt...");
  await sendTelegramMessage(token, chatId, messageText);

  console.log("Đang gửi file báo cáo đầy đủ...");
  await sendTelegramDocument(token, chatId, reportPath, `Báo cáo chiến lược tuần ${date}`);

  console.log(`✓ Đã gửi báo cáo ${date} qua Telegram.`);
}

main().catch((err) => {
  console.error("❌ Lỗi:", err.message);
  process.exit(1);
});
