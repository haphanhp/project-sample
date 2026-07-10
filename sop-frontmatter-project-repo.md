# SOP — Hướng dẫn sử dụng Project Repo & Chuẩn Frontmatter cho Dashboard

**Áp dụng cho:** vault Obsidian (bất kỳ tên nào bạn đặt) → repo dashboard
này → site deploy trên Netlify (domain của bạn)

---

## 1. Luồng hoạt động tổng quát

```
Bạn viết/sửa note trong Obsidian
  (thư mục 300 🚰 Pipelines/330 🧗 Projects/  hoặc  320 🛠 Actions/)
        ↓  Obsidian Git tự commit + push
GitHub Action trong repo vault tự chạy
        ↓  Copy file .md sang repo "projects" (bỏ qua file có sync: false)
scripts/build-data.js đọc toàn bộ file .md, build ra JSON
        ↓
Netlify tự deploy lại → web cập nhật
```

Bạn **chỉ cần viết đúng file `.md`** với frontmatter chuẩn — mọi thứ còn lại tự động.

---

## 2. Frontmatter chuẩn — mẫu đầy đủ cho 1 Project

```yaml
---
title: Tên dự án hiển thị trên web
description: Một câu mô tả ngắn, hiện ngay dưới tiêu đề trên card.
tags: [project, radar]
status: active
visibility: private
priority: 1
goal: earn-money
parent-project: 
deadline: 
link: 
repo: 
started: 
sync: 
---
```

Bên dưới frontmatter là nội dung ghi chú bình thường, checklist dùng đúng cú pháp Markdown chuẩn:

```markdown
## Checklist

- [x] Việc đã xong
- [ ] Việc chưa làm
```

---

## 3. Tác dụng chi tiết từng field

### `title` (khuyến nghị luôn điền)
- **Tác dụng:** tên hiển thị trên card và trang chi tiết project.
- Nếu để trống → dashboard tự lấy tên file (không đuôi `.md`) làm tiêu đề.
- **Ví dụ:** `title: Hệ Thống Radar Cá Nhân`

### `description` (tùy chọn)
- **Tác dụng:** câu mô tả ngắn hiện ngay dưới tiêu đề trên card.
- Để trống thì card không hiện dòng mô tả, không lỗi gì.

### `tags` (khuyến nghị)
- **Tác dụng:**
  1. Hiện thành các nhãn nhỏ (chip) trên card.
  2. Dùng để **lọc** trên dashboard (bộ lọc tag ở trang chủ).
  3. Có **2 tag đặc biệt mang tác dụng hệ thống**, xem mục 4 bên dưới (`archive`).
- **Cú pháp:** `tags: [project, radar, finance]` (mảng, ngăn cách bằng dấu phẩy).

### `status`
- **Tác dụng:** quyết định project hiện "done" (dấu ✓ 100%) hay "in-progress" trên dashboard.
- **Giá trị được nhận diện là "xong":** đúng chữ `done` (không phân biệt hoa thường: `Done`, `DONE` đều được).
- Bất kỳ giá trị nào khác (`active`, `next-up`, để trống...) → dashboard coi là "in-progress", % hiển thị tính theo checklist thật.
- **Lưu ý:** field này dùng chung cho cả Obsidian Dataview (hiển thị bảng Active/Done trong vault) — xem thêm ghi chú ở mục 6.

### `visibility` — quyết định ai xem được project này
| Giá trị | Ai xem được | Ghi vào |
|---|---|---|
| `public` | Bất kỳ ai vào web, không cần mật khẩu | `data-public.json` |
| `private` hoặc **để trống** | Chỉ người biết mật khẩu (vào `/private`) | `data-private.json` |

- **Mặc định an toàn:** không ghi gì = private. Phải **chủ động** ghi `public` mới công khai.
- Nếu project cha là `public` nhưng có project con `private` → project con đó **không hiện** trong cây con ở bản public, số % của cha ở bản public cũng không cộng số của con private vào.

### `priority` — thứ tự ưu tiên hiển thị
- **Tác dụng:** số càng **nhỏ** thì project càng hiện **trước** (lên đầu danh sách).
- Project không ghi `priority` → tự động xếp **cuối cùng**.
- Cùng mức `priority` → project có hoạt động (commit) gần đây nhất lên trước.
- **Ví dụ:** `priority: 1` (ưu tiên cao nhất) đến `priority: 4` (thấp hơn).

### `goal` — nhóm project theo mục tiêu cá nhân (⚠️ luôn ẩn khỏi bản public)
- **Tác dụng:** gắn nhãn mục tiêu (vd `earn-money`, `learn`, `portfolio`) —
  hiện thành chip màu riêng trên card (mỗi giá trị `goal` được tự động gán
  1 màu ổn định), dùng để **lọc** trên dashboard qua nhóm filter "Goal".
- **Cú pháp:** 1 chuỗi text tự do, không phải mảng — `goal: earn-money`.
- **Quan trọng — quyền riêng tư:** field này **CHỈ xuất hiện trong
  `data-private.json`**, bất kể `visibility` của project là gì.
  `data-public.json` luôn trả `goal: null` cho mọi project. Đây là thiết
  kế cố ý (không phải bug) — mục tiêu cá nhân/tài chính không nên lộ ra
  bản công khai dù project đó `visibility: public`.
- Để trống = project không thuộc goal nào, không hiện chip, không lỗi gì.
- Nhóm filter "Goal" trên UI tự ẩn hoàn toàn nếu không có project nào
  (trong tập dữ liệu đang xem) có `goal`.

### `parent-project` — gom vào project cha
- **Tác dụng:** biến project này thành **project con**, checklist của nó được cộng gộp vào project cha, hiện lồng bên dưới cha trên dashboard (badge "N sub-projects").
- **Tên field:** `parent-project` là tên chuẩn khuyến nghị, nhưng hệ thống
  cũng nhận diện `parent`, `parentProject`, `project-parent` (dùng field
  đầu tiên có giá trị theo đúng thứ tự này nếu bạn lỡ ghi trùng nhiều
  field) — không bắt buộc phải đổi lại các file cũ.
- **Cách ghi — chấp nhận cả 2 kiểu:**
  1. **Slug thường** (khuyến nghị): chữ thường, không dấu, khoảng trắng
     → gạch ngang. Vd file cha `Hệ Thống Radar.md` → `parent-project:
     he-thong-radar`.
  2. **Wikilink**: `parent-project: "[[Hệ Thống Radar]]"` cũng hoạt động.
- **Khớp project cha qua nhiều "tên gọi":** filename gốc, `title`,
  `alias`/`aliases` trong frontmatter, và slug ASCII suy ra từ các tên đó
  — nên dù bạn gõ tay `he-thong-radar` mà file cha có `alias: [Radar Ca
  Nhan]`, hệ thống vẫn thử khớp theo mọi biến thể trước khi báo lỗi.
- **Không khớp được → có cảnh báo rõ trong log build**: nếu 1 project
  khai `parent-project` nhưng không tìm thấy cha nào khớp, dòng log build
  sẽ in `⚠️ Project khai parent nhưng KHÔNG khớp được project cha nào` kèm
  tên file — không âm thầm hiện sai chỗ nữa.
- Lồng được **không giới hạn số tầng** (con của con của con... vẫn gộp đúng lên tận gốc).
- Để trống = project độc lập, không thuộc project nào.

### `link` (tùy chọn)
- **Tác dụng:** hiện nút "Xem thành quả" (mở tab mới), dùng cho URL demo/sản phẩm sống (vd Netlify, web app đã deploy).
- Để trống → không hiện nút này, không lỗi gì.

### `repo` (tùy chọn)
- **Tác dụng:** hiện nút "Repo", dùng cho link mã nguồn (GitHub).
- Để trống → không hiện nút này.
- `link` và `repo` hoàn toàn độc lập — có 1 trong 2, có cả 2, hoặc không có gì đều hoạt động bình thường.

### `started` (tùy chọn)
- **Tác dụng:** ngày "bắt đầu" hiện ở cuối trang chi tiết project.
- Để trống → dashboard tự dùng ngày **tạo file** làm ngày bắt đầu.
- **Định dạng:** `YYYY-MM-DD`, ví dụ `2026-01-10`.

### `deadline` (tùy chọn) — bật bảng Deadline/KPI trong tab Report
- **Tác dụng:** ghi ngày deadline mong muốn, hệ thống tự tính trạng thái
  KPI — **không cần tự đánh giá bằng mắt**, tính thẳng từ checklist thật.
- **Định dạng:** `YYYY-MM-DD`, ví dụ `deadline: 2026-08-01`.
- ⚠️ Không cần bọc ngoặc kép — hệ thống tự chuẩn hoá đúng định dạng dù
  YAML parse ra Date object phía sau (đã fix bug ngày 8/7: ngày không
  ngoặc kép từng bị lưu sai thành `"2026-08-01T00:00:00.000Z"` làm hỏng
  toàn bộ phép tính KPI). Áp dụng tương tự cho field `started`.
- Project không có `deadline` → không xuất hiện trong bảng KPI (không bắt
  buộc phải khai cho mọi project, chỉ khai cho cái nào thật sự có hạn).

**Cách đọc bảng KPI (tab `/report`):**
- Hệ thống vẽ 1 đường thẳng tưởng tượng từ `started` → `deadline`, tính
  "lẽ ra phải xong bao nhiêu %" tại **hôm nay** nếu đi đúng nhịp đều đặn
  (`% kỳ vọng`), rồi so với `% thật` từ checklist.
- **🟢 On track** — đang bằng hoặc nhanh hơn nhịp kỳ vọng, hoặc deadline
  còn xa.
- **🟡 At risk** — chậm hơn kỳ vọng quá 15 điểm %, **hoặc** deadline còn
  ≤7 ngày mà chưa đạt 90%. Đây là tín hiệu "cần để ý", không phải báo
  động khẩn.
- **🔴 Overdue** — đã qua deadline mà vẫn chưa `status: done`.
- **⚪ Done** — đã đánh dấu xong, không tính rủi ro nữa (kể cả xong trễ).
- Bảng tự sắp: Overdue lên đầu → At risk → On track → Done, trong mỗi
  nhóm sắp theo deadline gần nhất trước.
- **Giới hạn cần biết:** công thức giả định tiến độ đều tuyến tính theo
  thời gian — thực tế công việc thường dồn cuối hoặc có giai đoạn nghiên
  cứu chậm rồi làm nhanh, nên "At risk" sớm không có nghĩa là thật sự trễ,
  chỉ là tín hiệu để tự kiểm tra lại, không phải phán quyết cuối cùng.

### `sync` — chặn không cho đồng bộ ra ngoài vault
- **Tác dụng:** nếu ghi `sync: false`, file này **không bao giờ** được copy từ vault sang repo `projects` — vĩnh viễn chỉ nằm trong Obsidian của bạn.
- Dùng cho ghi chú thật sự riêng tư (không muốn kể cả bản private trên web thấy).
- Để trống hoặc bất kỳ giá trị nào khác `false` → đồng bộ bình thường.

---

## 3.1. Tab Report (`/report`, chỉ ở bản private)

Vào từ nút "Report →" cạnh nút chuyển bản private trên dashboard. Gồm:

| Mục | Dựa trên field nào | Ghi chú |
|---|---|---|
| Streak | tự động từ git activity | không cần khai gì thêm |
| Velocity (12 tuần) | tự động từ git activity | proxy cho "mức độ bận rộn", không phải % hoàn thành thật theo thời gian (hệ thống không lưu lịch sử % theo ngày) |
| Deadline / KPI | `deadline` | xem hướng dẫn đọc bảng ở mục `deadline` phía trên |
| Estimated completion | `started` + checklist + activity | ước tính thô, không phải cam kết — dựa trên tốc độ hoàn thành trung bình |
| Stale but important | `priority` + `status` + activity | project có priority, chưa done, ≥14 ngày không động tới |
| Goal allocation | `goal` | % active days và % completed items theo từng `goal` |

---

## 4. Tag đặc biệt: `archive` — ẩn hẳn project khỏi dashboard

```yaml
tags: [project, archive]
```

- Project có tag này (và **toàn bộ project con/cháu của nó**, đệ quy không giới hạn tầng) sẽ **biến mất hoàn toàn** khỏi cả bản public lẫn private trên dashboard.
- File vẫn còn nguyên trong vault/repo git — chỉ là không hiển thị lên web nữa.
- Dùng khi: project đã cũ, không cần theo dõi tiến độ nữa, nhưng chưa muốn xóa hẳn ghi chú.

---

## 5. Frontmatter cho file Action (task rời)

```yaml
---
tags:
  - action
projects: []
pillars: []
created: 2026-07-07
---
```

- Action là các task lẻ, không phải "1 project = 1 file" như trên.
- **Cách nối Action vào Project:** dùng `[[wikilink]]` trỏ tới project trong **nội dung** file Action (không phải trong frontmatter) — ví dụ gõ `[[Hệ Thống Radar]]` ở đâu đó trong thân bài.
- Checklist (`- [ ]` / `- [x]`) trong Action sẽ được **cộng dồn** vào project mà nó link tới.
- **Lan truyền qua nhiều tầng:** Action A có thể link tới Action B (không cần link thẳng project), miễn B đã được tính vào 1 project nào đó, A cũng tự động được gộp vào đúng project đó.
- Action không link tới project nào vẫn được tính, nhưng **không hiện** trên dashboard — hệ thống sẽ in cảnh báo "orphan action" trong log build để bạn biết bổ sung link.

---

## 6. Lưu ý quan trọng cần nhớ

1. **`status: done` không cần tick hết từng checkbox** — chỉ cần ghi đúng field này, dashboard tự tính 100% dù checkbox thật trong file chưa tick hết. Việc này **không** sửa lại checkbox gốc trong Obsidian.
2. **File lỗi cú pháp YAML (frontmatter) sẽ tự động bị bỏ qua**, không làm sập cả dashboard — nhưng file đó cũng **không hiện lên web**. Kiểm tra log build trên Netlify (dòng `⚠️ Bỏ qua project lỗi frontmatter: ...`) để biết file nào cần sửa lại cú pháp.
3. **`parent-project` giờ khớp linh hoạt hơn** — thử theo filename, `title`, `alias`, và slug ASCII của từng cái, cả 2 kiểu ghi (slug thường hoặc `[[wikilink]]`) đều được. Nếu vẫn không khớp, log build sẽ báo rõ tên file bị "mồ côi" thay vì âm thầm sai.
4. **Muốn hiện lên web bắt buộc phải nằm đúng thư mục** — `300 🚰 Pipelines/330 🧗 Projects/` (cho project) hoặc `320 🛠 Actions/` (cho action). Gắn tag `project`/`action` không đủ nếu file nằm sai thư mục — workflow đồng bộ lọc theo **đường dẫn thư mục**, không lọc theo tag.
5. **Mặc định mọi thứ là private** — nếu không ghi `visibility: public`, project sẽ không hiện ở bản xem công khai (không cần mật khẩu). Đây là thiết kế an toàn có chủ đích.

---

## 7. Bảng tra cứu nhanh (cheat sheet)

| Muốn làm gì | Ghi field nào |
|---|---|
| Hiện công khai, ai cũng xem được | `visibility: public` |
| Chỉ mình xem (cần mật khẩu) | `visibility: private` (hoặc để trống) |
| Đưa lên đầu danh sách | `priority: 1` |
| Nhóm theo mục tiêu cá nhân (luôn ẩn khỏi public) | `goal: earn-money` |
| Gom vào 1 project cha | `parent-project: slug-cua-cha` |
| Theo dõi tiến độ so với hạn chót (bảng KPI ở tab Report) | `deadline: YYYY-MM-DD` |
| Đánh dấu xong 100% mà không cần tick từng dòng | `status: done` |
| Ẩn hẳn khỏi dashboard (còn giữ file) | thêm tag `archive` |
| Không đồng bộ ra khỏi vault | `sync: false` |
| Thêm nút xem sản phẩm sống | `link: https://...` |
| Thêm nút xem mã nguồn | `repo: https://...` |
