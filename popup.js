/**
 * popup.js — trang cấu hình (dùng chung cho popup và options_ui).
 *
 * Key và model được lưu RIÊNG cho từng nhà cung cấp, nên người dùng có thể
 * nhập sẵn nhiều key rồi chuyển qua lại mà không mất cấu hình:
 *   { provider, apiKeys: {…}, models: {…}, baseUrl, temperature, … }
 */

const DEFAULTS = {
  provider: 'gemini',
  apiKeys: {},
  models: {},
  baseUrl: '',
  temperature: 0.4,
  extraInstruction: '',
  showButton: true,
  blocklist: '',
};

const $ = (id) => document.getElementById(id);
const els = {
  provider: $('provider'),
  baseUrlField: $('baseUrlField'),
  baseUrl: $('baseUrl'),
  apiKey: $('apiKey'),
  keyLink: $('keyLink'),
  model: $('model'),
  modelList: $('modelList'),
  modelHint: $('modelHint'),
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

/** Bản sao trong bộ nhớ — cho phép đổi provider mà không mất key đang gõ dở. */
let state = { ...DEFAULTS };
let providers = [];
const byId = (id) => providers.find((p) => p.id === id);

function setStatus(msg, kind = '') {
  els.status.textContent = msg;
  els.status.className = 'status' + (kind ? ` status--${kind}` : '');
}

// ---------------------------------------------------------------------------
// Khởi tạo
// ---------------------------------------------------------------------------
(async function init() {
  // Lấy danh sách provider từ background thay vì khai báo lại ở đây,
  // để chỉ có một nguồn sự thật duy nhất là providers.js
  const res = await chrome.runtime.sendMessage({ type: 'GET_PROVIDERS' });
  providers = res?.providers || [];

  for (const p of providers) {
    els.provider.add(new Option(p.label, p.id));
  }

  state = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  if (!byId(state.provider)) state.provider = providers[0]?.id || 'gemini';

  els.provider.value = state.provider;
  els.baseUrl.value = state.baseUrl;
  els.temperature.value = state.temperature;
  els.tempOut.value = Number(state.temperature).toFixed(1);
  els.extra.value = state.extraInstruction;
  els.showButton.checked = state.showButton;
  els.blocklist.value = state.blocklist;

  renderProvider();
})();

/** Vẽ lại các trường phụ thuộc nhà cung cấp đang chọn. */
function renderProvider() {
  const p = byId(state.provider);
  if (!p) return;

  els.apiKey.value = state.apiKeys[p.id] || '';
  els.apiKey.placeholder = p.keyPlaceholder;
  els.model.value = state.models[p.id] || p.defaultModel;
  els.model.placeholder = p.defaultModel || 'tên model';

  // Chỉ endpoint tuỳ chỉnh mới cần Base URL
  els.baseUrlField.hidden = !p.needsBaseUrl;

  if (p.keyUrl) {
    els.keyLink.href = p.keyUrl;
    els.keyLink.textContent = new URL(p.keyUrl).hostname;
    els.keyLink.removeAttribute('aria-disabled');
  } else {
    // Endpoint tuỳ chỉnh: không có trang key cố định để trỏ tới
    els.keyLink.removeAttribute('href');
    els.keyLink.textContent = 'trang quản lý key của dịch vụ bạn dùng';
    els.keyLink.setAttribute('aria-disabled', 'true');
  }

  // Datalist gợi ý model nhưng vẫn cho gõ tự do — tên model đổi liên tục,
  // khoá cứng bằng <select> sẽ khiến tiện ích lạc hậu sau vài tháng.
  els.modelList.textContent = '';
  for (const [id, note] of p.models || []) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.label = note;
    els.modelList.appendChild(opt);
  }

  els.modelHint.textContent = p.models?.length
    ? 'Gõ tên bất kỳ hoặc chọn từ gợi ý. Gặp lỗi 404 thì tên model sai.'
    : 'Nhập chính xác tên model mà endpoint của bạn cung cấp.';
}

// ---------------------------------------------------------------------------
// Sự kiện
// ---------------------------------------------------------------------------

els.provider.addEventListener('change', () => {
  captureCurrentProvider();      // giữ lại key/model đang gõ trước khi đổi
  state.provider = els.provider.value;
  renderProvider();
  setStatus('');
});

els.temperature.addEventListener('input', () => {
  els.tempOut.value = Number(els.temperature.value).toFixed(1);
});

els.toggle.addEventListener('click', () => {
  els.apiKey.type = els.apiKey.type === 'password' ? 'text' : 'password';
});

/** Đẩy giá trị đang hiện trên form vào state của provider hiện tại. */
function captureCurrentProvider() {
  const id = els.provider.value;
  state.apiKeys = { ...state.apiKeys, [id]: els.apiKey.value.trim() };
  state.models = { ...state.models, [id]: els.model.value.trim() };
}

// ---------------------------------------------------------------------------
// Lưu
// ---------------------------------------------------------------------------
async function save({ silent = false } = {}) {
  captureCurrentProvider();

  const p = byId(els.provider.value);
  const key = state.apiKeys[els.provider.value] || '';
  let warned = false;

  // Kiểm tra sơ bộ để bắt lỗi copy dính khoảng trắng — KHÔNG khoá cứng tiền tố,
  // vì mỗi nhà cung cấp một định dạng và định dạng còn đổi theo thời gian.
  if (key && !/^[A-Za-z0-9._\-]{20,}$/.test(key)) {
    setStatus('⚠ Key có ký tự lạ hoặc quá ngắn (dính khoảng trắng khi copy?). Vẫn lưu.', 'err');
    warned = true;
  }
  if (p?.needsBaseUrl && !els.baseUrl.value.trim()) {
    setStatus('⚠ Endpoint tuỳ chỉnh cần Base URL. Vẫn lưu.', 'err');
    warned = true;
  }

  await chrome.storage.local.set({
    provider: els.provider.value,
    apiKeys: state.apiKeys,
    models: state.models,
    baseUrl: els.baseUrl.value.trim(),
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

  if (!silent && !warned) setStatus('✓ Đã lưu cấu hình.', 'ok');
  return key;
}

els.save.addEventListener('click', () => save());

// ---------------------------------------------------------------------------
// Kiểm tra kết nối: lưu trước rồi gọi thử một request thật qua background
// ---------------------------------------------------------------------------
els.test.addEventListener('click', async () => {
  const key = await save({ silent: true });
  const p = byId(els.provider.value);

  if (!key && !p?.needsBaseUrl) {
    setStatus(`✗ Chưa nhập API key cho ${p?.label || 'nhà cung cấp này'}.`, 'err');
    return;
  }

  els.test.disabled = true;
  els.save.disabled = true;
  setStatus(`Đang gọi thử ${p?.label}…`);

  const res = await chrome.runtime.sendMessage({ type: 'TEST_KEY' });

  els.test.disabled = false;
  els.save.disabled = false;
  setStatus(
    res?.ok ? `✓ Kết nối thành công với ${res.model}.` : `✗ ${res?.error || 'Không rõ lỗi.'}`,
    res?.ok ? 'ok' : 'err'
  );
});

// Ctrl/Cmd + Enter để lưu nhanh
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') save();
});
