# ✨ Prompt Rewriter — Gemini

Chrome Extension (Manifest V3) viết lại / tối ưu prompt thô bằng Gemini API — hoạt động trên **mọi trang web**, không chỉ Google AI Studio.

## Ba cách dùng

| Cách | Khi nào tiện |
|---|---|
| Nút **✨** hiện lên khi bạn click vào ô nhập liệu | Dùng hằng ngày, mọi trang |
| Phím tắt `Ctrl+Shift+U` | Nhanh nhất, không rời bàn phím |
| Chuột phải → **✨ Viết lại…** | Ô nhập bị che, hoặc chỉ muốn viết lại đoạn đang bôi đen |

Bôi đen một phần trong ô nhập rồi kích hoạt → chỉ phần đó được viết lại, phần còn lại giữ nguyên.
Bôi đen text ở vùng **không sửa được** (bài báo, comment người khác) → kết quả tự vào clipboard.

## Trang đã tối ưu riêng

Nút gắn thẳng cạnh nút Send/Run, và selector ô nhập được nhắm chính xác:

`aistudio.google.com` · `chatgpt.com` · `claude.ai` · `gemini.google.com` · `perplexity.ai` · `grok.com` / `x.com`

Mọi trang khác dùng cơ chế dò tổng quát: `textarea`, `[contenteditable]`, `input[type=text|search|url|email]`.

## Cài đặt (Developer Mode)

1. Mở Chrome → gõ `chrome://extensions` vào thanh địa chỉ.
2. Bật **Developer mode** (góc trên bên phải).
3. Bấm **Load unpacked** → chọn thư mục chứa `manifest.json`.
4. Ghim 📌 extension lên toolbar.
5. Lấy API key miễn phí tại <https://aistudio.google.com/apikey> → **Create API key**.
6. Bấm icon extension → dán key → chọn model → **Lưu cấu hình** → **Kiểm tra kết nối**.
7. Vào bất kỳ trang nào có ô nhập text, gõ prompt thô, bấm ✨ hoặc `Ctrl+Shift+U`.

## Cấu hình trong popup

- **API Key** — chấp nhận cả format cũ `AIza...` lẫn format mới `AQ.Ab8...`
- **Model** — mặc định `gemini-2.5-flash`
- **Độ sáng tạo** — thấp = bám sát ý gốc
- **Hướng dẫn bổ sung** — nối vào system instruction, ví dụ "luôn viết prompt bằng tiếng Anh"
- **Hiện nút ✨** — tắt đi thì chỉ còn phím tắt + menu chuột phải, trang web hoàn toàn sạch
- **Blocklist** — tắt hẳn extension trên các tên miền bạn liệt kê (áp dụng cả tên miền con, có hiệu lực ngay)

## Test nhanh

| Bước | Hành động | Kỳ vọng |
|---|---|---|
| 1 | Click ô tìm kiếm bất kỳ trang nào | Nút ✨ tròn hiện ở góc trên-phải ô đó |
| 2 | Cuộn trang | Nút bám theo ô |
| 3 | Gõ `viet bai blog ve ca phe` → `Ctrl+Shift+U` | Nội dung ô được thay bằng prompt có cấu trúc |
| 4 | Bấm **Hoàn tác** trên toast | Nội dung gốc quay lại |
| 5 | Bôi đen 1 câu trong ô → chuột phải → Viết lại | Chỉ câu đó đổi |
| 6 | Bôi đen text trên một bài báo → chuột phải → Viết lại | Toast báo đã copy vào clipboard |
| 7 | Thêm tên miền vào blocklist → Lưu | Nút biến mất ngay, không cần F5 |
| 8 | Xoá API key → thử lại | Toast đỏ "Chưa có API key…" |

## Debug

- **Content script**: F12 trên trang đang test → tab Console.
- **Service worker**: `chrome://extensions` → thẻ extension → link **service worker**.
- Sau khi sửa code: bấm ↻ Reload trên thẻ extension, **rồi F5 lại trang** (content script cũ đã mất context — extension sẽ báo đúng thông điệp này nếu bạn quên).
- Đổi phím tắt: `chrome://extensions/shortcuts`.

## Ghi chú kỹ thuật

- Toàn bộ lời gọi Gemini API nằm trong `background.js` (service worker) — content script mang origin của trang chủ nhà nên fetch trực tiếp sẽ bị CORS chặn.
- Ghi giá trị vào ô nhập qua **native property setter** rồi phát sự kiện `input` bubbling; gán `el.value` trực tiếp không kích hoạt state của React/Vue/Angular, khiến nút Send của trang vẫn disabled.
- Với editor rich-text (ProseMirror của ChatGPT/Claude, Quill của Gemini) dùng `execCommand('insertText')` để giữ undo stack và cập nhật state nội bộ của editor.
- API key gửi qua header `x-goog-api-key`, không đưa vào query string.
- API key chỉ lưu trong `chrome.storage.local` — không đồng bộ, không rời khỏi máy.
- Prompt của bạn được gửi tới Google Gemini API để xử lý. Đừng dùng trên nội dung nhạy cảm.

### Giới hạn đã biết

- Không hoạt động trong **iframe** (`all_frames: false`) và trong **shadow DOM đóng**.
- Không chạy trên trang `chrome://`, Chrome Web Store, và các trang nội bộ khác của trình duyệt — đây là giới hạn cứng của Chrome.
- Extension xin quyền `<all_urls>` nên Chrome sẽ cảnh báo "Read and change all your data on all websites". Nếu muốn thu hẹp, sửa `matches` trong `manifest.json` thành danh sách domain cụ thể.

## License

MIT
