# Hướng dẫn quay video demo

Quy trình chuẩn để tạo GIF hero + MP4 demo cho README.

---

## 1. Cài công cụ

```bash
winget install NickeManarin.ScreenToGif Microsoft.PowerToys Gyan.FFmpeg
```

| Công cụ | Vai trò |
|---|---|
| **ScreenToGif** | Quay vùng màn hình + **biên tập từng frame** (cắt quãng chờ API) + xuất GIF/MP4 |
| **PowerToys** | Mouse Highlighter (`Win+Shift+H`) — vòng tròn hiện khi click, người xem thấy được bạn bấm gì |
| **ffmpeg** | Nén MP4 xuống dưới 10 MB, chuyển MP4 → GIF với bảng màu tối ưu |

Muốn hiện phím tắt trên màn hình (để demo `Ctrl+Shift+U`), tìm thêm:

```bash
winget search carnac
```

---

## 2. Chuẩn bị môi trường

### Cửa sổ Chrome kích thước cố định

Không bao giờ kéo tay — kích thước lẻ làm video bị scale mờ.

```bash
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --new-window --window-size=1280,800 --window-position=40,40 https://chatgpt.com
```

### Checklist dọn khung hình

- [ ] `Ctrl+Shift+B` — ẩn thanh bookmark
- [ ] Đóng hết tab thừa, chỉ để 1–2 tab liên quan
- [ ] `Ctrl+0` — zoom về đúng 100%
- [ ] Bật **Do Not Disturb** của Windows (thông báo nhảy vào là hỏng cả lần quay)
- [ ] Tắt các extension khác để toolbar gọn
- [ ] Bật Mouse Highlighter: `Win+Shift+H`

### Checklist bảo mật

- [ ] Tạo **API key riêng cho demo**, xoá ngay sau khi quay xong
- [ ] Ô API key trong popup là `type="password"` → **không bấm nút 👁** trong lúc quay
- [ ] Che/tránh avatar Google và email ở góc phải trên
- [ ] Không quay màn hình có tab Gmail, Zalo, hay tài liệu nội bộ

---

## 3. Storyboard — 25 giây, 3 cảnh

Ba cảnh tương ứng ba cơ chế kích hoạt, chứng minh đúng khẩu hiệu "dùng ở mọi nơi".

### Cảnh 1 — Nút ✨ trên trang bất kỳ (0:00 – 0:12)

| Thời điểm | Hành động | Ghi chú quay |
|---|---|---|
| 0:00 | Trang ChatGPT trống, con trỏ nháy trong ô chat | Bắt đầu ở trạng thái tĩnh 1s |
| 0:01 | Gõ `viet bai blog ve ca phe` | Gõ tốc độ bình thường, đừng quá nhanh |
| 0:04 | **Dừng 1 giây** để nút ✨ hiện rõ ở góc ô | Khoảnh khắc quan trọng nhất — đừng vội |
| 0:05 | Di chuột chậm tới nút, click | Mouse Highlighter làm nổi cú click |
| 0:06 | Toast "Đang viết lại…" | **Cắt bớt quãng chờ API còn ~1.5s khi biên tập** |
| 0:08 | Prompt có cấu trúc xuất hiện | Dừng 3s cho người xem đọc |
| 0:11 | Bấm **Hoàn tác** → prompt gốc quay lại | Chứng minh thao tác an toàn, không mất dữ liệu |

### Cảnh 2 — Phím tắt trên AI Studio (0:12 – 0:19)

| Thời điểm | Hành động |
|---|---|
| 0:12 | Chuyển tab sang `aistudio.google.com` — thấy nút pill ✨ Rewrite cạnh nút Run |
| 0:14 | Gõ prompt thô, nhấn `Ctrl+Shift+U` |
| 0:16 | Kết quả thay vào ô |

### Cảnh 3 — Chuột phải, viết lại phần bôi đen (0:19 – 0:25)

| Thời điểm | Hành động |
|---|---|
| 0:19 | Bôi đen **một câu** trong ô nhập |
| 0:21 | Chuột phải → menu → **✨ Viết lại đoạn đang chọn** |
| 0:23 | Chỉ câu đó đổi, phần còn lại giữ nguyên |

**GIF hero** = chỉ cảnh 1 (12s). **MP4 đầy đủ** = cả 3 cảnh.

### Nguyên tắc quay

- Di chuột **chậm và dứt khoát**, đi thẳng tới đích, không lượn vòng
- **Dừng 1 giây trước và sau** mỗi thao tác quan trọng
- Quay lại nhiều lần cho tới khi được một lần sạch, đừng cố ghép
- Không quay quá 40s cho bản thô — càng dài càng khó cắt

---

## 4. Thông số quay (ScreenToGif)

| Tham số | Giá trị | Lý do |
|---|---|---|
| FPS quay | 25 | Đủ mượt, dư frame để cắt khi biên tập |
| Vùng quay | Đúng cửa sổ Chrome 1280×800 | Snap vào cửa sổ, không lấy taskbar |
| FPS xuất GIF | 14–15 | 25fps làm GIF phình gấp đôi mà mắt không phân biệt được |
| Chiều rộng GIF | 900–960 px | Vừa khung README của GitHub |

Trong tab **Editor** của ScreenToGif trước khi xuất:

1. Xoá các frame chờ API (chọn khoảng frame → Delete) — thường cắt được 30–40% dung lượng
2. Cắt frame thừa ở đầu/cuối
3. `Reduce Frame Count` nếu vẫn quá nặng

---

## 5. Xử lý hậu kỳ bằng ffmpeg

### Cắt đoạn thừa (không mã hoá lại, tức thì)

```bash
ffmpeg -ss 00:00:03 -to 00:00:28 -i raw.mp4 -c copy trimmed.mp4
```

### Nén MP4 cho GitHub (mục tiêu < 10 MB)

```bash
ffmpeg -i trimmed.mp4 -vf "scale=1280:-2" -c:v libx264 -profile:v high -pix_fmt yuv420p -crf 26 -preset slow -movflags +faststart -an demo.mp4
```

Ba cờ bắt buộc, thiếu là trình duyệt không phát được:

- `-pix_fmt yuv420p` — Safari/Firefox từ chối định dạng màu khác
- `-profile:v high` + `libx264` — H.264, codec GitHub khuyến nghị
- `-movflags +faststart` — đưa metadata lên đầu file để phát ngay, không phải tải hết

`-crf` càng cao càng nhẹ: 23 (nét) → 26 (cân bằng) → 30 (nhẹ, hơi mờ). Nếu vẫn quá 10 MB, tăng `-crf` trước, đừng hạ độ phân giải.

### MP4 → GIF chất lượng cao (bảng màu 2 lượt)

Cách này cho GIF nét hơn hẳn so với xuất trực tiếp, vì ffmpeg quét toàn video để dựng bảng màu tối ưu trước:

```bash
ffmpeg -i demo.mp4 -vf "fps=15,scale=920:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 docs/demo.gif
```

- `stats_mode=diff` — ưu tiên màu ở vùng **có chuyển động**, giữ chữ nét
- `diff_mode=rectangle` — chỉ mã hoá vùng thay đổi giữa các frame, giảm mạnh dung lượng
- `max_colors=160` — hạ từ 256 xuống, tiết kiệm ~20% mà mắt thường không thấy khác

### Kiểm tra dung lượng

```bash
Get-ChildItem docs\demo.gif, demo.mp4 | Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}
```

GIF phải **dưới 10 MB**, lý tưởng là dưới 5 MB. Vượt thì quay lại bước biên tập frame.

---

## 6. Đưa lên GitHub

### GIF — commit vào repo

```bash
git add docs/demo.gif && git commit -m "docs: thêm GIF demo" && git push
```

Rồi bỏ comment khối `![Demo](docs/demo.gif)` trong `README.md`.

### MP4 — KHÔNG commit, phải upload qua web

MP4 commit vào repo rồi nhúng bằng `![]()` **sẽ không phát**. Làm đúng cách:

1. Mở `README.md` trên github.com → bấm ✏️ **Edit**
2. **Kéo-thả** file `demo.mp4` vào ô soạn thảo
3. GitHub upload và tự chèn URL dạng `https://github.com/user-attachments/assets/<uuid>`
4. Để **URL trần trên một dòng riêng** — GitHub tự biến thành player. Đừng bọc trong `![]()` hay `[]()`
5. Commit ngay trên web

### Giới hạn GitHub (đã xác minh 08/2026)

| Loại | Giới hạn |
|---|---|
| Ảnh & GIF | 10 MB |
| Video, tài khoản free | 10 MB |
| Video, tài khoản trả phí | 100 MB |
| Định dạng video | `.mp4`, `.mov`, `.webm` — khuyến nghị codec H.264 |

Nguồn: [GitHub Docs — Attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)

---

## 7. Dọn dẹp sau khi quay

- [ ] **Xoá API key dùng để demo** tại <https://aistudio.google.com/apikey>
- [ ] Xoá file quay thô (`raw.mp4`, `trimmed.mp4`) — đừng commit nhầm
- [ ] Xem lại GIF/video một lượt cuối, soi kỹ xem có lộ email, tên file cá nhân, hay tab nào không
