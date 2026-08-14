# ✨ AI Studio Prompt Rewriter

Chrome Extension (Manifest V3) chèn nút **✨ Rewrite** vào Google AI Studio để viết lại / tối ưu prompt thô bằng Gemini API.

## Cài đặt (Developer Mode)

1. Mở Chrome → gõ `chrome://extensions` vào thanh địa chỉ.
2. Bật công tắc **Developer mode** ở góc trên bên phải.
3. Bấm **Load unpacked** → chọn đúng thư mục `rewrite_prompt` (thư mục chứa `manifest.json`).
4. Extension xuất hiện trong danh sách. Bấm biểu tượng ghim 📌 trên toolbar để ghim cho tiện.
5. Lấy API key miễn phí tại <https://aistudio.google.com/apikey> → **Create API key**.
6. Bấm icon extension → dán key → chọn model → **Lưu cấu hình** → **Kiểm tra kết nối** (phải ra `✓ Kết nối thành công`).
7. Mở <https://aistudio.google.com/prompts/new_chat>, gõ một prompt thô, bấm **✨ Rewrite** cạnh nút Run (hoặc `Ctrl+Shift+U`).

## Test nhanh

| Bước | Hành động | Kỳ vọng |
|---|---|---|
| 1 | Gõ `viet bai blog ve ca phe` rồi bấm Rewrite | Toast "Đang viết lại prompt…" → prompt trong ô được thay bằng bản có Role/Task/Output format |
| 2 | Bấm **Hoàn tác** trên toast | Prompt gốc quay lại nguyên vẹn |
| 3 | Xoá API key trong popup rồi Rewrite | Toast đỏ: "Chưa có API key…" |
| 4 | Bấm Rewrite khi ô trống | Toast đỏ: "Ô nhập đang trống…" |
| 5 | Bấm Rewrite ~20 lần liên tiếp | Toast đỏ 429: "Vượt hạn mức…" |
| 6 | Đổi phím tắt tại `chrome://extensions/shortcuts` | Phím mới hoạt động |

## Debug

- **Content script**: F12 trên tab AI Studio → tab Console.
- **Service worker**: `chrome://extensions` → thẻ extension → link **service worker** → DevTools riêng.
- Sau khi sửa code: bấm nút ↻ Reload trên thẻ extension, rồi **F5 lại tab AI Studio** (content script cũ đã mất context).

## Ghi chú kỹ thuật

- Toàn bộ lời gọi Gemini API nằm trong `background.js` (service worker) — content script chạy dưới origin `aistudio.google.com` nên fetch trực tiếp sẽ bị CORS chặn.
- API key gửi qua header `x-goog-api-key`, không đưa vào query string.
- API key chỉ lưu trong `chrome.storage.local` (không đồng bộ, không rời khỏi máy).
- `gemini-1.5-flash` đã ngừng cấp cho project mới — mặc định dùng `gemini-2.5-flash`.
