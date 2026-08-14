/**
 * content.js — chạy trên MỌI trang web.
 *
 * Triết lý thiết kế: không treo nút cố định gây vướng trang. Nút chỉ xuất hiện
 * khi người dùng thực sự focus vào một ô nhập liệu, và bám theo góc ô đó.
 * Riêng các site đã biết (AI Studio, ChatGPT, Claude…) thì gắn nút dạng pill
 * ngay cạnh nút Send/Run cho tự nhiên.
 *
 * KHÔNG fetch API ở đây: content script mang origin của trang chủ nhà nên sẽ bị
 * CORS chặn. Toàn bộ lời gọi Gemini uỷ quyền cho service worker.
 */

(() => {
  'use strict';

  if (window.__promptRewriterLoaded) return;   // background có thể inject lại
  window.__promptRewriterLoaded = true;

  const BTN_ID = 'ps-rewrite-btn';
  const TOAST_ID = 'ps-rewrite-toast';

  // =========================================================================
  // 0. CẤU HÌNH RUNTIME
  // =========================================================================

  let settings = { showButton: true, blocklist: [] };
  let disabledHere = false;

  function hostMatches(pattern, host) {
    const p = pattern.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!p) return false;
    return host === p || host.endsWith('.' + p);
  }

  async function loadSettings() {
    const s = await chrome.storage.local.get({ showButton: true, blocklist: '' });
    settings.showButton = s.showButton;
    settings.blocklist = String(s.blocklist || '').split(/[\n,]+/).filter(Boolean);
    disabledHere = settings.blocklist.some((p) => hostMatches(p, location.hostname));
    if (disabledHere) teardown();
  }

  // Đổi cấu hình trong popup có hiệu lực ngay, không cần F5
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if ('showButton' in changes || 'blocklist' in changes) loadSettings().then(scheduleMount);
  });

  // =========================================================================
  // 1. SITE PROFILES — selector riêng cho các trang chat AI phổ biến
  // =========================================================================

  const SITE_PROFILES = [
    {
      name: 'aistudio',
      host: /(^|\.)aistudio\.google\.com$/,
      input: ['ms-prompt-input-wrapper textarea', 'ms-autosize-textarea textarea', 'ms-chunk-editor textarea'],
      anchor: ['run-button button', 'button[aria-label="Run"]', 'button.run-button'],
    },
    {
      name: 'chatgpt',
      host: /(^|\.)chatgpt\.com$|(^|\.)openai\.com$/,
      input: ['#prompt-textarea', 'div.ProseMirror[contenteditable="true"]', 'textarea[data-id]'],
      anchor: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]'],
    },
    {
      name: 'claude',
      host: /(^|\.)claude\.ai$/,
      input: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      anchor: ['button[aria-label*="Send" i]'],
    },
    {
      name: 'gemini',
      host: /(^|\.)gemini\.google\.com$/,
      input: ['rich-textarea div.ql-editor', 'div.ql-editor[contenteditable="true"]'],
      anchor: ['button.send-button', 'button[aria-label*="Send" i]'],
    },
    {
      name: 'perplexity',
      host: /(^|\.)perplexity\.ai$/,
      input: ['textarea[placeholder]', 'div[contenteditable="true"]'],
      anchor: ['button[aria-label*="Submit" i]'],
    },
    {
      name: 'grok',
      host: /(^|\.)grok\.com$|(^|\.)x\.com$/,
      input: ['textarea', 'div[contenteditable="true"]'],
      anchor: ['button[aria-label*="Submit" i]', 'button[data-testid="tweetButtonInline"]'],
    },
  ];

  const PROFILE = SITE_PROFILES.find((p) => p.host.test(location.hostname)) || { name: 'generic' };

  /** Fallback dùng cho mọi trang không có profile riêng. */
  const GENERIC_INPUT = [
    'textarea:not([readonly]):not([disabled])',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]',
    'input[type="text"]',
    'input[type="search"]',
    'input:not([type])',
  ];

  // =========================================================================
  // 2. NHẬN DIỆN Ô NHẬP LIỆU
  // =========================================================================

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return !el.disabled && !el.readOnly;
    if (el.tagName === 'INPUT') {
      // Loại trừ password/số/checkbox… — viết lại prompt ở đó là vô nghĩa
      const t = (el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'email'].includes(t) && !el.disabled && !el.readOnly;
    }
    return false;
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 60 || r.height < 14) return false;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
  }

  /** Ô nhập được focus gần nhất — nguồn chân lý chính khi dùng ở trang lạ. */
  let activeInput = null;

  document.addEventListener('focusin', (e) => {
    if (disabledHere) return;
    const el = e.target;
    if (isEditable(el) && isVisible(el)) {
      activeInput = el;
      scheduleMount();
    }
  }, true);

  document.addEventListener('focusout', () => {
    if (disabledHere) return;
    // Trễ nhẹ: click vào nút của ta cũng sinh focusout, không được ẩn vội
    setTimeout(() => {
      const ae = document.activeElement;
      if (isEditable(ae)) return;
      if (ae?.id === BTN_ID) return;
      if (!busy) hideFloating();
    }, 180);
  }, true);

  /**
   * Tìm ô nhập để viết lại, theo thứ tự ưu tiên:
   *   1. Ô đang/vừa focus (đúng ý người dùng nhất)
   *   2. Selector của site profile
   *   3. Selector tổng quát — lấy ô hiển thị lớn nhất
   */
  function findInput() {
    if (isEditable(activeInput) && isVisible(activeInput)) return activeInput;

    const lists = [PROFILE.input || [], GENERIC_INPUT];
    for (const list of lists) {
      for (const sel of list) {
        let nodes;
        try { nodes = [...document.querySelectorAll(sel)]; } catch { continue; }
        const found = nodes.filter((el) => isEditable(el) && isVisible(el));
        if (!found.length) continue;
        found.sort((a, b) => area(b) - area(a));   // ô lớn nhất thường là ô chat chính
        return found[0];
      }
    }
    return null;
  }

  const area = (el) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };

  // =========================================================================
  // 3. ĐỌC / GHI GIÁ TRỊ
  // =========================================================================

  function readValue(el) {
    return el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.innerText;
  }

  /** Đoạn text đang được bôi đen bên trong ô nhập (nếu có). */
  function readSelection(el) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const { selectionStart: s, selectionEnd: e } = el;
      return s != null && e != null && e > s ? el.value.slice(s, e) : '';
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return '';
    return el.contains(sel.anchorNode) ? sel.toString() : '';
  }

  /**
   * React/Vue/Angular đều bind qua property setter riêng của prototype.
   * Gán el.value = x trực tiếp KHÔNG kích hoạt state của framework => trang
   * tưởng ô vẫn rỗng và nút Send vẫn disabled. Phải gọi native setter rồi
   * phát 'input' bubbling để framework nghe thấy.
   */
  function writeValue(el, text, { replaceSelection = false } = {}) {
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

      let next = text;
      let caret = text.length;
      if (replaceSelection && el.selectionEnd > el.selectionStart) {
        const s = el.selectionStart;
        next = el.value.slice(0, s) + text + el.value.slice(el.selectionEnd);
        caret = s + text.length;
      }

      setter ? setter.call(el, next) : (el.value = next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));

      el.focus();
      try { el.setSelectionRange(caret, caret); } catch { /* input type=email không cho */ }

      // Ép các textarea autosize tính lại chiều cao
      el.style.height = 'auto';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // contenteditable (ProseMirror của ChatGPT/Claude, Quill của Gemini…):
    // execCommand('insertText') là cách duy nhất giữ được undo stack và
    // khiến các rich editor cập nhật state nội bộ đúng cách.
    el.focus();
    const sel = window.getSelection();

    if (!replaceSelection || sel.isCollapsed || !el.contains(sel.anchorNode)) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    if (!document.execCommand('insertText', false, text)) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
    }
  }

  /** Dự phòng cho vùng không sửa được (bài báo, comment người khác…). */
  function copyToClipboard(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* bị chặn */ }
    ta.remove();
    return ok;
  }

  // =========================================================================
  // 4. TOAST
  // =========================================================================

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
      undo.addEventListener('mousedown', (e) => e.preventDefault());
      undo.addEventListener('click', () => { onUndo(); hideToast(); });
      box.appendChild(undo);
    }

    box.classList.add('ps-toast--show');
    clearTimeout(toastTimer);
    if (duration > 0) toastTimer = setTimeout(hideToast, duration);
  }

  function hideToast() {
    document.getElementById(TOAST_ID)?.classList.remove('ps-toast--show');
  }

  // =========================================================================
  // 5. LUỒNG CHÍNH
  // =========================================================================

  let busy = false;

  /**
   * @param {object}  opts
   * @param {boolean} opts.selectionOnly  Chỉ viết lại phần đang bôi đen
   * @param {string}  opts.fallbackText   Text từ context menu khi không có ô nhập
   */
  async function rewrite({ selectionOnly = false, fallbackText = '' } = {}) {
    if (busy) return;

    const input = findInput();

    // Không có ô nhập nào (bôi đen text trên trang tĩnh) -> trả kết quả qua clipboard
    if (!input) {
      const text = (fallbackText || String(window.getSelection() || '')).trim();
      if (!text) {
        toast('Hãy click vào ô nhập liệu hoặc bôi đen đoạn text trước.', 'error');
        return;
      }
      return runRemote(text, (out, truncated) => {
        const copied = copyToClipboard(out);
        toast(
          (copied ? 'Đã viết lại và copy vào clipboard (Ctrl+V để dán).' : 'Đã viết lại nhưng không copy được.') +
            (truncated ? ' Kết quả bị cắt do giới hạn token.' : ''),
          copied ? 'success' : 'error',
          { duration: 6000 }
        );
      });
    }

    const selected = readSelection(input);
    const useSelection = selectionOnly && !!selected;
    const source = (useSelection ? selected : readValue(input)).trim();

    if (!source) { toast('Ô nhập đang trống — hãy gõ prompt thô trước.', 'error'); return; }
    if (source.length > 20000) { toast('Nội dung quá dài (>20.000 ký tự).', 'error'); return; }

    const snapshot = readValue(input);   // để hoàn tác

    return runRemote(source, (out, truncated) => {
      writeValue(input, out, { replaceSelection: useSelection });
      const msg = (useSelection ? 'Đã viết lại phần bôi đen.' : 'Đã viết lại prompt.') +
        (truncated ? ' Kết quả bị cắt do giới hạn token.' : '');
      toast(msg, 'success', {
        duration: 8000,
        onUndo: () => {
          writeValue(input, snapshot);
          toast('Đã khôi phục nội dung gốc.', 'info', { duration: 2500 });
        },
      });
    });
  }

  /** Gọi background, xử lý trạng thái nút + lỗi. onDone chỉ chạy khi thành công. */
  async function runRemote(text, onDone) {
    busy = true;
    setButtonState('loading');
    toast('Đang viết lại…', 'loading', { duration: 0 });

    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'REWRITE', text });
    } catch {
      // Extension vừa reload -> context của content script cũ đã chết
      res = { ok: false, error: 'Tiện ích vừa được tải lại. Hãy F5 trang rồi thử lại.' };
    } finally {
      busy = false;
      setButtonState('idle');
    }

    if (!res?.ok) {
      toast(res?.error || 'Lỗi không xác định.', 'error', { duration: 7000 });
      return;
    }
    onDone(res.text, !!res.truncated);
  }

  // =========================================================================
  // 6. NÚT — 2 chế độ: inline (site đã biết) và floating (bám ô đang focus)
  // =========================================================================

  function buildButton() {
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Viết lại prompt bằng Gemini');
    btn.title = 'Viết lại prompt bằng Gemini (Ctrl+Shift+U)';
    btn.innerHTML = '<span class="ps-icon">✨</span><span class="ps-label">Rewrite</span>';
    // Giữ con trỏ ở lại trong ô nhập khi bấm nút
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      rewrite();
    });
    return btn;
  }

  const getButton = () => document.getElementById(BTN_ID);

  function setButtonState(state) {
    const btn = getButton();
    if (!btn) return;
    const loading = state === 'loading';
    btn.classList.toggle('ps-rewrite-btn--busy', loading);
    btn.disabled = loading;
    btn.querySelector('.ps-label').textContent = loading ? 'Đang xử lý…' : 'Rewrite';
  }

  function findAnchor() {
    for (const sel of PROFILE.anchor || []) {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && el.parentElement) return el.parentElement;
    }
    return null;
  }

  /** Đặt nút nổi ngay trên góc phải của ô đang focus, kẹp trong viewport. */
  function positionFloating(btn, target) {
    const r = target.getBoundingClientRect();
    const w = btn.offsetWidth || 30;
    const h = btn.offsetHeight || 30;

    let top = r.top - h - 6;
    if (top < 4) top = Math.min(r.bottom + 6, innerHeight - h - 4);   // không đủ chỗ phía trên

    const left = Math.max(4, Math.min(r.right - w, innerWidth - w - 4));

    btn.style.top = `${Math.round(top)}px`;
    btn.style.left = `${Math.round(left)}px`;
  }

  function hideFloating() {
    const btn = getButton();
    if (btn?.classList.contains('ps-rewrite-btn--floating')) btn.remove();
  }

  function teardown() {
    getButton()?.remove();
    hideToast();
  }

  function mount() {
    if (disabledHere || !settings.showButton) { teardown(); return; }

    const anchor = findAnchor();
    let btn = getButton();

    // --- Chế độ inline: gắn cạnh nút Send/Run của site đã biết ---
    if (anchor) {
      if (btn && btn.parentElement === anchor && !btn.classList.contains('ps-rewrite-btn--floating')) return;
      btn = btn || buildButton();
      btn.classList.remove('ps-rewrite-btn--floating');
      btn.style.top = btn.style.left = '';
      anchor.insertBefore(btn, anchor.firstChild);
      return;
    }

    // --- Chế độ floating: chỉ hiện khi có ô nhập đang focus ---
    const target = isEditable(activeInput) && isVisible(activeInput) ? activeInput : null;
    if (!target) { hideFloating(); return; }

    btn = btn || buildButton();
    btn.classList.add('ps-rewrite-btn--floating');
    if (btn.parentElement !== document.body) document.body.appendChild(btn);
    positionFloating(btn, target);
  }

  // Debounce bằng rAF: SPA re-render rất dày, không thể xử lý từng mutation
  let raf = 0;
  function scheduleMount() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; mount(); });
  }

  new MutationObserver(scheduleMount).observe(document.documentElement, { childList: true, subtree: true });

  // Nút nổi phải bám theo ô khi cuộn / đổi kích thước cửa sổ
  addEventListener('scroll', scheduleMount, { passive: true, capture: true });
  addEventListener('resize', scheduleMount, { passive: true });
  addEventListener('popstate', () => setTimeout(scheduleMount, 500));   // SPA đổi route

  // =========================================================================
  // 7. LỆNH TỪ PHÍM TẮT / MENU CHUỘT PHẢI
  // =========================================================================

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'TRIGGER_REWRITE') {
      if (disabledHere) {
        toast('Tiện ích đang bị tắt trên tên miền này (xem blocklist trong popup).', 'error');
      } else {
        rewrite({ selectionOnly: !!msg.selectionOnly, fallbackText: msg.selectionText || '' });
      }
      sendResponse({ ok: true });
    }
    return false;
  });

  loadSettings().then(scheduleMount);
})();
