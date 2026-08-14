/**
 * popup.js — trang cấu hình (dùng chung cho popup và options_ui).
 * Đọc/ghi chrome.storage.local: apiKey, model, temperature, extraInstruction.
 */

const DEFAULTS = {
  apiKey: '',
  model: 'gemini-2.5-flash',
  temperature: 0.4,
  extraInstruction: '',
  showButton: true,
  blocklist: '',
};

const $ = (id) => document.getElementById(id);
const els = {
  apiKey: $('apiKey'),
  model: $('model'),
  temperature: $('temperature'),
  tempOut: $('tempOut'),
  extra: $('extraInstruction'),
  showButton: $('showButton'),
  blocklist: $('blocklist'),
  save: $('save'),
  test: $('test'),
  toggle: $('toggleKey'),
  status: $('status'),
};

function setStatus(msg, kind = '') {
  els.status.textContent = msg;
  els.status.className = 'status' + (kind ? ` status--${kind}` : '');
}

// ---------------------------------------------------------------------------
// Nạp cấu hình đã lưu
// ---------------------------------------------------------------------------
(async function load() {
  const cfg = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  els.apiKey.value = cfg.apiKey;
  els.temperature.value = cfg.temperature;
  els.tempOut.value = Number(cfg.temperature).toFixed(1);
  els.extra.value = cfg.extraInstruction;
  els.showButton.checked = cfg.showButton;
  els.blocklist.value = cfg.blocklist;

  // Model đã lưu có thể không nằm trong danh sách mặc định -> thêm động
  if (![...els.model.options].some((o) => o.value === cfg.model)) {
    els.model.add(new Option(cfg.model, cfg.model));
  }
  els.model.value = cfg.model;
})();

els.temperature.addEventListener('input', () => {
  els.tempOut.value = Number(els.temperature.value).toFixed(1);
});

els.toggle.addEventListener('click', () => {
  els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
});

// ---------------------------------------------------------------------------
// Lưu
// ---------------------------------------------------------------------------
async function save({ silent = false } = {}) {
  const apiKey = els.apiKey.value.trim();

  // Kiểm tra sơ bộ để bắt lỗi dán thiếu/thừa ký tự hoặc dính khoảng trắng.
  // Google dùng 2 format: key cũ "AIza..." và key mới của AI Studio "AQ.Ab8...".
  // Vì vậy chỉ kiểm tra bộ ký tự + độ dài, KHÔNG khoá cứng tiền tố.
  if (apiKey && !/^[A-Za-z0-9._-]{25,}$/.test(apiKey)) {
    setStatus('⚠ Key có ký tự lạ hoặc quá ngắn (dính khoảng trắng khi copy?). Vẫn lưu.', 'err');
  }

  await chrome.storage.local.set({
    apiKey,
    model: els.model.value,
    temperature: parseFloat(els.temperature.value),
    extraInstruction: els.extra.value.trim(),
    showButton: els.showButton.checked,
    // Chuẩn hoá: bỏ scheme/đường dẫn, hạ chữ thường — content.js so khớp thuần hostname
    blocklist: els.blocklist.value
      .split(/[\n,]+/)
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean)
      .join('\n'),
  });

  // Hiển thị lại bản đã chuẩn hoá để người dùng thấy đúng thứ sẽ được áp dụng
  els.blocklist.value = (await chrome.storage.local.get('blocklist')).blocklist;

  if (!silent && !els.status.textContent.startsWith('⚠')) {
    setStatus('✓ Đã lưu cấu hình.', 'ok');
  }
  return apiKey;
}

els.save.addEventListener('click', () => save());

// ---------------------------------------------------------------------------
// Kiểm tra kết nối: lưu trước rồi gọi thử một request thật qua background
// ---------------------------------------------------------------------------
els.test.addEventListener('click', async () => {
  const apiKey = await save({ silent: true });
  if (!apiKey) {
    setStatus('✗ Chưa nhập API key.', 'err');
    return;
  }

  els.test.disabled = true;
  els.save.disabled = true;
  setStatus('Đang gọi thử Gemini API…');

  const res = await chrome.runtime.sendMessage({ type: 'TEST_KEY' });

  els.test.disabled = false;
  els.save.disabled = false;
  setStatus(
    res?.ok ? `✓ Kết nối thành công với ${els.model.value}.` : `✗ ${res?.error || 'Không rõ lỗi.'}`,
    res?.ok ? 'ok' : 'err'
  );
});

// Ctrl/Cmd + Enter để lưu nhanh
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
});
