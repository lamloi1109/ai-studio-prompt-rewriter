/**
 * content.js — chạy trên https://aistudio.google.com/*
 *
 * Trách nhiệm:
 *  1. Tìm ô nhập prompt của AI Studio (SPA Angular, DOM đổi liên tục).
 *  2. Chèn nút "✨ Rewrite" cạnh nút Run, tự gắn lại khi Angular render lại DOM.
 *  3. Đọc prompt thô -> nhờ background gọi Gemini -> ghi kết quả trở lại ô nhập.
 *  4. Hiển thị toast trạng thái: đang gọi / thiếu key / lỗi mạng / quota, kèm Hoàn tác.
 *
 * Lưu ý: KHÔNG fetch trực tiếp ở đây. Content script mang origin của trang
 * aistudio.google.com nên request tới generativelanguage.googleapis.com sẽ bị
 * CORS chặn; toàn bộ lời gọi API được uỷ quyền cho service worker.
 */

(() => {
  'use strict';

  // Tránh chạy 2 lần khi background inject lại bằng chrome.scripting
  if (window.__aiStudioRewriterLoaded) return;
  window.__aiStudioRewriterLoaded = true;

  const BTN_ID = 'ps-rewrite-btn';
  const TOAST_ID = 'ps-rewrite-toast';

  // -------------------------------------------------------------------------
  // 1. TÌM Ô NHẬP LIỆU
  // -------------------------------------------------------------------------

  /** Selector ưu tiên theo cấu trúc thật của AI Studio, xếp từ cụ thể -> tổng quát. */
  const INPUT_SELECTORS = [
    'ms-prompt-input-wrapper textarea',
    'ms-autosize-textarea textarea',
    'ms-chunk-editor textarea',
    'textarea[aria-label*="prompt" i]',
    'textarea[placeholder*="prompt" i]',
    'textarea[aria-label*="Type something" i]',
    'ms-prompt-input-wrapper [contenteditable="true"]',
    'textarea',
    '[contenteditable="true"][role="textbox"]',
  ];

  /** Phần tử có đang hiển thị & đủ lớn để là ô nhập chính không? */
  function isUsable(el) {
    if (!el || !el.isConnected || el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 16) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  /** Ô nhập được người dùng focus gần nhất — ưu tiên cao nhất khi bấm phím tắt. */
  let lastFocused = null;
  document.addEventListener(
    'focusin',
    (e) => {
      const t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.isContentEditable)) lastFocused = t;
    },
    true
  );

  function findInput() {
    if (isUsable(lastFocused)) return lastFocused;

    for (const sel of INPUT_SELECTORS) {
      const found = [...document.querySelectorAll(sel)].filter(isUsable);
      if (!found.length) continue;
      // Nhiều textarea cùng tồn tại (system instruction, chat...) -> lấy cái lớn nhất
      found.sort((a, b) => area(b) - area(a));
      return found[0];
    }
    return null;
  }

  const area = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };

  // -------------------------------------------------------------------------
  // 2. ĐỌC / GHI GIÁ TRỊ (tương thích Angular)
  // -------------------------------------------------------------------------

  function readValue(el) {
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText;
  }

  /**
   * Angular/Material bind qua property setter riêng. Gán el.value = x trực tiếp
   * sẽ KHÔNG kích hoạt ValueAccessor => trang tưởng ô vẫn rỗng, bấm Run mất chữ.
   * Cách đúng: gọi native setter của prototype rồi phát sự kiện 'input' bubbling.
   */
  function writeValue(el, text) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, text) : (el.value = text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.height = 'auto'; // ép autosize tính lại chiều cao
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      // contenteditable: dùng execCommand để giữ nguyên undo stack của trình duyệt
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand('insertText', false, text)) {
        el.textContent = text;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      }
    }

    // Đưa con trỏ về cuối cho người dùng gõ tiếp
    el.focus();
    if (el.setSelectionRange) el.setSelectionRange(text.length, text.length);
  }

  // -------------------------------------------------------------------------
  // 3. TOAST TRẠNG THÁI
  // -------------------------------------------------------------------------

  let toastTimer = null;

  function toast(message, kind = 'info', { onUndo = null, duration = 4000 } = {}) {
    let box = document.getElementById(TOAST_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = TOAST_ID;
      document.body.appendChild(box);
    }
    box.className = `ps-toast ps-toast--${kind}`;
    box.textContent = '';

    if (kind === 'loading') {
      const spin = document.createElement('span');
      spin.className = 'ps-spinner';
      box.appendChild(spin);
    }

    const label = document.createElement('span');
    label.textContent = message;
    box.appendChild(label);

    if (onUndo) {
      const undo = document.createElement('button');
      undo.className = 'ps-toast__undo';
      undo.textContent = 'Hoàn tác';
      undo.addEventListener('click', () => {
        onUndo();
        hideToast();
      });
      box.appendChild(undo);
    }

    box.classList.add('ps-toast--show');
    clearTimeout(toastTimer);
    if (duration > 0) toastTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    document.getElementById(TOAST_ID)?.classList.remove('ps-toast--show');
  }

  // -------------------------------------------------------------------------
  // 4. LUỒNG CHÍNH
  // -------------------------------------------------------------------------

  let busy = false;

  async function rewrite() {
    if (busy) return;

    const input = findInput();
    if (!input) {
      toast('Không tìm thấy ô nhập prompt. Hãy click vào ô chat rồi thử lại.', 'error');
      return;
    }

    const original = readValue(input).trim();
    if (!original) {
      toast('Ô nhập đang trống — hãy gõ prompt thô trước.', 'error');
      return;
    }
    if (original.length > 20000) {
      toast('Prompt quá dài (>20.000 ký tự).', 'error');
      return;
    }

    busy = true;
    setButtonState('loading');
    toast('Đang viết lại prompt…', 'loading', { duration: 0 });

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'REWRITE', text: original });
    } catch {
      // Xảy ra khi extension vừa được reload -> context của content script cũ đã chết
      res = { ok: false, error: 'Tiện ích vừa được tải lại. Hãy F5 trang rồi thử lại.' };
    } finally {
      busy = false;
      setButtonState('idle');
    }

    if (!res?.ok) {
      toast(res?.error || 'Lỗi không xác định.', 'error', { duration: 7000 });
      return;
    }

    writeValue(input, res.text);

    const note = res.truncated ? 'Đã viết lại (bị cắt do đạt giới hạn token).' : 'Đã viết lại prompt.';
    toast(note, 'success', {
      duration: 8000,
      onUndo: () => {
        writeValue(input, original);
        toast('Đã khôi phục prompt gốc.', 'info', { duration: 2500 });
      },
    });
  }

  // -------------------------------------------------------------------------
  // 5. CHÈN NÚT & GIỮ NÚT SỐNG SÓT QUA CÁC LẦN RE-RENDER
  // -------------------------------------------------------------------------

  /** Tìm thanh công cụ chứa nút Run để đặt nút cạnh bên. */
  function findAnchor() {
    const runBtn =
      document.querySelector('run-button button') ||
      document.querySelector('button[aria-label="Run"]') ||
      document.querySelector('button.run-button') ||
      [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim().toLowerCase() === 'run' && isUsable(b)
      );
    return runBtn?.parentElement || null;
  }

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'ps-rewrite-btn';
    btn.title = 'Viết lại prompt bằng Gemini (Ctrl+Shift+U)';
    btn.innerHTML = '<span class="ps-icon">✨</span><span class="ps-label">Rewrite</span>';
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      rewrite();
    });
    return btn;
  }

  function setButtonState(state) {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.classList.toggle('ps-rewrite-btn--busy', state === 'loading');
    btn.disabled = state === 'loading';
    btn.querySelector('.ps-label').textContent = state === 'loading' ? 'Đang xử lý…' : 'Rewrite';
  }

  function mountButton() {
    const existing = document.getElementById(BTN_ID);
    const anchor = findAnchor();

    // Nút đã nằm đúng chỗ -> không làm gì (tránh nhấp nháy mỗi lần DOM đổi)
    if (existing && anchor && existing.parentElement === anchor) return;
    if (existing && !anchor && existing.classList.contains('ps-rewrite-btn--floating')) return;

    const btn = existing || buildButton();

    if (anchor) {
      btn.classList.remove('ps-rewrite-btn--floating');
      anchor.insertBefore(btn, anchor.firstChild);
    } else {
      // Fallback: AI Studio đổi layout / trang chưa render xong -> nút nổi góc phải
      btn.classList.add('ps-rewrite-btn--floating');
      document.body.appendChild(btn);
    }
  }

  // MutationObserver + debounce: Angular re-render rất dày, không thể xử lý từng mutation
  let raf = 0;
  const observer = new MutationObserver(() => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      mountButton();
    });
  });

  observer.observe(document.body, { childList: true, subtree: true });
  mountButton();

  // SPA đổi route mà không reload trang -> gắn lại nút
  window.addEventListener('popstate', () => setTimeout(mountButton, 500));

  // -------------------------------------------------------------------------
  // 6. NHẬN LỆNH TỪ PHÍM TẮT (chrome.commands -> background -> đây)
  // -------------------------------------------------------------------------
  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'TRIGGER_REWRITE') {
      rewrite();
      sendResponse({ ok: true });
    }
    return false;
  });
})();
