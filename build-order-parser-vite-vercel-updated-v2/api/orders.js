function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function formatTelegramMessage(payload) {
  const lines = Array.isArray(payload?.lines) ? payload.lines : [];
  const top = lines.slice(0, 20).map((l, i) => {
    const qty = toNum(l.qty);
    const name = l?.selected?.name || l?.parsedText || l?.raw || "позиция";
    const sku = l?.selected?.sku ? ` [${l.selected.sku}]` : "";
    const conf = typeof l?.confidence === "number" ? ` (${Math.round(l.confidence * 100)}%)` : "";
    return `${i + 1}) ${escapeHtml(name)}${escapeHtml(sku)} — <b>${qty}</b> ${escapeHtml(l.unit || "шт")}${escapeHtml(conf)}`;
  });

  const unresolvedCount = lines.filter(l => !l?.selected).length;
  const total = toNum(payload?.total);
  const createdAt = payload?.createdAt ? new Date(payload.createdAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' }) : new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

  return [
    `📦 <b>Новый заказ</b>`,
    `⏰ ${escapeHtml(createdAt)} (МСК)`,
    `💰 Сумма: <b>${total.toLocaleString('ru-RU')}</b>`,
    `📄 Позиций: <b>${lines.length}</b>${unresolvedCount ? `, нераспознано: <b>${unresolvedCount}</b>` : ""}`,
    payload?.clientName ? `👤 ${escapeHtml(payload.clientName)}` : null,
    payload?.clientPhone ? `☎️ ${escapeHtml(payload.clientPhone)}` : null,
    top.length ? "\n<b>Состав заказа:</b>" : null,
    ...top,
    lines.length > top.length ? `… ещё ${lines.length - top.length} поз.` : null,
    payload?.dirtyText ? `\n<b>Исходный текст:</b>\n<code>${escapeHtml(String(payload.dirtyText).slice(0, 1200))}</code>` : null,
  ].filter(Boolean).join("\n");
}

async function sendTelegram(payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, skipped: true, reason: 'TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured' };
  }

  const text = formatTelegramMessage(payload);
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.ok) {
    throw new Error(`Telegram send failed: ${data?.description || `HTTP ${resp.status}`}`);
  }
  return { ok: true, messageId: data?.result?.message_id };
}

async function forwardIfNeeded(payload, req) {
  const forwardUrl = process.env.ORDER_FORWARD_URL;
  if (!forwardUrl) return { ok: false, skipped: true };

  const token = process.env.ORDER_FORWARD_TOKEN || '';
  const resp = await fetch(forwardUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'X-Source': 'vercel-order-endpoint'
    },
    body: JSON.stringify({ ...payload, receivedIp: req.headers['x-forwarded-for'] || '' })
  });
  if (!resp.ok) throw new Error(`Forward webhook HTTP ${resp.status}`);
  return { ok: true, status: resp.status };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    const apiKey = process.env.ORDER_API_KEY;
    if (apiKey) {
      const provided = req.headers['x-api-key'] || '';
      if (provided !== apiKey) {
        return res.status(401).json({ error: 'Invalid x-api-key' });
      }
    }

    const body = typeof req.body === 'object' && req.body ? req.body : {};
    const lines = Array.isArray(body.lines) ? body.lines : [];
    const orderText = String(body.orderText || '').trim();
    const dirtyText = String(body.dirtyText || '').trim();
    if (!lines.length && !orderText && !dirtyText) {
      return res.status(400).json({ error: 'Пустой заказ: передайте lines[] или orderText/dirtyText' });
    }

    const normalized = {
      createdAt: body.createdAt || new Date().toISOString(),
      clientName: body.clientName || '',
      clientPhone: body.clientPhone || '',
      source: body.source || 'build-order-parser-ui',
      dirtyText,
      orderText,
      total: toNum(body.total),
      lines: lines.map((l) => ({
        raw: l?.raw || '',
        parsedText: l?.parsedText || '',
        qty: toNum(l?.qty),
        unit: l?.unit || 'шт',
        confidence: typeof l?.confidence === 'number' ? l.confidence : null,
        selected: l?.selected ? {
          sku: l.selected.sku || '',
          name: l.selected.name || '',
          price: toNum(l.selected.price),
          category: l.selected.category || ''
        } : null
      }))
    };

    const [telegram, forward] = await Promise.all([
      sendTelegram(normalized),
      forwardIfNeeded(normalized, req)
    ]);

    return res.status(200).json({
      ok: true,
      message: 'Заказ принят',
      receivedAt: new Date().toISOString(),
      stats: {
        lines: normalized.lines.length,
        total: normalized.total,
        unresolved: normalized.lines.filter(x => !x.selected).length
      },
      telegram,
      forward
    });
  } catch (error) {
    console.error('Order endpoint error:', error);
    return res.status(500).json({ error: error.message || 'Unknown error' });
  }
}
