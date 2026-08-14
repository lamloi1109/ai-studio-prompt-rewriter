/**
 * providers.js — Bộ adapter cho từng nhà cung cấp LLM.
 *
 * Mỗi provider khai báo 3 thứ:
 *   build(ctx)  -> { url, headers, body }   dựng request
 *   parse(data) -> { text, truncated }      bóc kết quả
 *   hint(status, detail) -> string|null     gợi ý lỗi riêng của provider
 *
 * Được import bởi background.js (service worker chạy type: "module").
 */

// ---------------------------------------------------------------------------
// Danh sách tham số "tuỳ chọn" — nếu API trả 400 vì một trong số này,
// background.js sẽ gỡ nó ra và thử lại đúng một lần.
//
// Lý do tồn tại cơ chế này: mỗi đời model lại siết một tham số khác nhau.
// Anthropic bỏ hẳn `temperature` từ Opus 4.7; OpenAI đổi `max_tokens` thành
// `max_completion_tokens` ở các model reasoning. Thay vì hard-code bảng
// tương thích rồi lạc hậu sau vài tháng, ta để API tự nói và tự thích nghi.
// ---------------------------------------------------------------------------
export const OPTIONAL_PARAMS = [
  'temperature',
  'thinking',
  'max_completion_tokens',
  'max_tokens',
  'topP',
  'top_p',
];

const MAX_OUTPUT_TOKENS = 4096;

/** Bóc nội dung text từ response kiểu OpenAI (dùng chung cho 3 provider). */
function parseOpenAIShape(data) {
  const choice = data?.choices?.[0];
  if (!choice) return { text: '', truncated: false };

  const msg = choice.message || {};
  // Một số backend (vLLM, Ollama) trả content là mảng block thay vì string
  const text = Array.isArray(msg.content)
    ? msg.content.map((c) => c?.text || '').join('')
    : msg.content || '';

  return { text, truncated: choice.finish_reason === 'length' };
}

/** Dựng request kiểu OpenAI Chat Completions (dùng chung cho 3 provider). */
function buildOpenAIShape({ url, apiKey, model, system, user, temperature, extraHeaders = {}, tokenField }) {
  return {
    url,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      [tokenField]: MAX_OUTPUT_TOKENS,
      temperature,
    },
  };
}

export const PROVIDERS = {
  // =========================================================================
  // Google Gemini
  // =========================================================================
  gemini: {
    label: 'Google Gemini',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AQ.Ab8... hoặc AIza...',
    defaultModel: 'gemini-2.5-flash',
    models: [
      ['gemini-2.5-flash', 'cân bằng, khuyên dùng'],
      ['gemini-2.5-flash-lite', 'nhanh & quota free cao nhất'],
      ['gemini-2.0-flash', 'ổn định'],
      ['gemini-2.5-pro', 'chất lượng cao, quota free thấp'],
      ['gemini-flash-latest', 'luôn trỏ bản flash mới nhất'],
    ],

    build({ apiKey, model, system, user, temperature }) {
      return {
        url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        headers: {
          'Content-Type': 'application/json',
          // Dùng header thay ?key= để API key không lọt vào log URL
          'x-goog-api-key': apiKey,
        },
        body: {
          // systemInstruction tách riêng => model coi contents là DỮ LIỆU
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature,
            topP: 0.95,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            responseMimeType: 'text/plain',
          },
        },
      };
    },

    parse(data) {
      if (data?.promptFeedback?.blockReason) {
        throw new Error(`Nội dung bị chặn bởi bộ lọc an toàn (${data.promptFeedback.blockReason}).`);
      }
      const cand = data?.candidates?.[0];
      if (!cand) return { text: '', truncated: false };
      if (cand.finishReason && !['STOP', 'MAX_TOKENS'].includes(cand.finishReason)) {
        throw new Error(`Phản hồi bị dừng: ${cand.finishReason}.`);
      }
      return {
        text: (cand.content?.parts || []).map((p) => p.text || '').join(''),
        truncated: cand.finishReason === 'MAX_TOKENS',
      };
    },

    hint(status) {
      if (status === 403) return 'Kiểm tra key đã bật Generative Language API cho project chưa.';
      return null;
    },
  },

  // =========================================================================
  // Anthropic Claude
  // =========================================================================
  anthropic: {
    label: 'Anthropic Claude',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-haiku-4-5',
    models: [
      ['claude-haiku-4-5', 'nhanh & rẻ nhất — hợp việc viết lại prompt'],
      ['claude-sonnet-5', 'cân bằng'],
      ['claude-opus-5', 'mạnh nhất, đắt nhất'],
      ['claude-opus-4-8', 'đời trước của Opus'],
    ],

    build({ apiKey, model, system, user, temperature }) {
      const body = {
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        // `system` là trường top-level của Messages API, KHÔNG phải một message
        // có role: "system" như OpenAI. Gửi sai chỗ sẽ bị 400.
        system,
        messages: [{ role: 'user', content: user }],
        // Opus 5 bật thinking mặc định; thinking ăn chung hạn mức max_tokens
        // nên với việc viết lại prompt ta tắt đi cho đỡ tốn và đỡ bị cắt.
        // Model nào không nhận trường này sẽ bị gỡ tự động qua cơ chế retry.
        thinking: { type: 'disabled' },
      };

      // Anthropic đã BỎ HẲN temperature từ Opus 4.7 trở đi — gửi vào là 400.
      // Chỉ đính kèm cho các model đời cũ còn nhận; sai sót còn lại để retry lo.
      if (/haiku|claude-3/.test(model)) body.temperature = temperature;

      return {
        url: 'https://api.anthropic.com/v1/messages',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          // Anthropic chặn request mang Origin của trình duyệt. Service worker
          // của extension có host_permissions nên thường không bị vướng, nhưng
          // gửi kèm header này là cách thoát hiểm chuẩn cho môi trường browser.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body,
      };
    },

    parse(data) {
      if (data?.stop_reason === 'refusal') {
        const cat = data?.stop_details?.category;
        throw new Error(`Claude từ chối yêu cầu${cat ? ` (${cat})` : ''}. Thử đổi model hoặc sửa prompt.`);
      }
      return {
        text: (data?.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text || '')
          .join(''),
        truncated: data?.stop_reason === 'max_tokens',
      };
    },

    hint(status, detail) {
      if (status === 400 && /credit|balance/i.test(detail)) {
        return 'Tài khoản có thể đã hết credit — kiểm tra mục Billing.';
      }
      if (status === 404) return 'Model không tồn tại hoặc key chưa được cấp quyền dùng model đó.';
      return null;
    },
  },

  // =========================================================================
  // OpenAI
  // =========================================================================
  openai: {
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-proj-...',
    defaultModel: 'gpt-5-mini',
    models: [
      ['gpt-5-mini', 'nhanh & rẻ'],
      ['gpt-5', 'mạnh nhất'],
      ['gpt-4.1-mini', 'đời trước, rẻ'],
      ['gpt-4o-mini', 'đời cũ, rất rẻ'],
    ],

    build(ctx) {
      return buildOpenAIShape({
        ...ctx,
        url: 'https://api.openai.com/v1/chat/completions',
        // Model reasoning đời mới chỉ nhận max_completion_tokens;
        // nếu backend từ chối, cơ chế retry sẽ gỡ và thử lại.
        tokenField: 'max_completion_tokens',
      });
    },

    parse: parseOpenAIShape,

    hint(status, detail) {
      if (status === 429 && /quota|billing/i.test(detail)) {
        return 'Hết credit chứ không phải rate limit — nạp tiền tại platform.openai.com/billing.';
      }
      if (status === 404) return 'Model không tồn tại hoặc tài khoản chưa được cấp quyền. Gõ tên model khác.';
      return null;
    },
  },

  // =========================================================================
  // OpenRouter — cổng chung tới hàng trăm model
  // =========================================================================
  openrouter: {
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-v1-...',
    defaultModel: 'google/gemini-2.5-flash',
    models: [
      ['google/gemini-2.5-flash', 'nhanh, rẻ'],
      ['anthropic/claude-haiku-4.5', 'Claude giá thấp'],
      ['openai/gpt-5-mini', 'GPT giá thấp'],
      ['deepseek/deepseek-chat', 'rẻ, chất lượng khá'],
      ['meta-llama/llama-3.3-70b-instruct:free', 'miễn phí (có giới hạn)'],
    ],

    build(ctx) {
      return buildOpenAIShape({
        ...ctx,
        url: 'https://openrouter.ai/api/v1/chat/completions',
        tokenField: 'max_tokens',
        // OpenRouter dùng 2 header này để ghi nguồn trên bảng xếp hạng
        extraHeaders: {
          'HTTP-Referer': 'https://github.com/lamloi1109/ai-studio-prompt-rewriter',
          'X-Title': 'Prompt Rewriter',
        },
      });
    },

    parse: parseOpenAIShape,

    hint(status) {
      if (status === 402) return 'Hết credit OpenRouter — nạp tại openrouter.ai/credits.';
      if (status === 404) return 'Tên model sai. Phải đúng dạng "nhà-cung-cấp/tên-model", xem openrouter.ai/models.';
      return null;
    },
  },

  // =========================================================================
  // Endpoint tự nhập — mọi API tương thích OpenAI
  // (Groq, Together, DeepSeek, Mistral, Ollama, LM Studio, vLLM…)
  // =========================================================================
  custom: {
    label: 'Khác (tương thích OpenAI)',
    keyUrl: '',
    keyPlaceholder: 'API key của dịch vụ (để trống nếu chạy local)',
    defaultModel: '',
    models: [],
    needsBaseUrl: true,

    build(ctx) {
      const base = (ctx.baseUrl || '').trim().replace(/\/+$/, '');
      if (!base) throw new Error('Chưa nhập Base URL cho endpoint tuỳ chỉnh.');

      // Cho phép người dùng nhập cả "https://x.com/v1" lẫn đường dẫn đầy đủ
      const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;

      return buildOpenAIShape({ ...ctx, url, tokenField: 'max_tokens' });
    },

    parse: parseOpenAIShape,

    hint(status) {
      if (status === 404) return 'Sai Base URL hoặc tên model. Base URL thường kết thúc bằng /v1.';
      return null;
    },
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS);
