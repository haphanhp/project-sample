// netlify/functions/private-data.js
//
// Trả về toàn bộ dữ liệu project (public + private) — NHƯNG chỉ khi request
// kèm đúng mật khẩu qua header "x-dashboard-key". Mật khẩu thật lưu trong biến
// môi trường PRIVATE_DASHBOARD_PASSWORD (Netlify → Site settings → Environment
// variables), KHÔNG commit vào repo nên không lộ dù repo có bị public.
//
// data-private.json nằm CÙNG THƯ MỤC với function này (không nằm trong
// thư mục publish tĩnh "public/"), nên không ai tải trực tiếp được qua URL
// tĩnh — chỉ đọc được qua function này, và chỉ khi đúng mật khẩu.
//
// Lưu ý: không đặt tên biến là "__dirname" — khi Netlify bundle function ESM,
// nó tự chèn sẵn __dirname vào code, nên tự khai báo lại sẽ gây lỗi
// "Identifier '__dirname' has already been declared". Dùng tên khác (currentDir).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const currentDir = path.dirname(fileURLToPath(import.meta.url));
export default async (req) => {
  const expected = process.env.PRIVATE_DASHBOARD_PASSWORD;
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "Server chưa cấu hình PRIVATE_DASHBOARD_PASSWORD." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
  const provided = req.headers.get("x-dashboard-key") || "";
  if (provided !== expected) {
    return new Response(JSON.stringify({ error: "Sai mật khẩu." }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    const raw = readFileSync(path.join(currentDir, "data-private.json"), "utf-8");
    return new Response(raw, {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Không đọc được data-private.json." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/.netlify/functions/private-data" };



