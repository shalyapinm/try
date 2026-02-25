export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    const lines = Array.isArray(body.lines) ? body.lines : [];
    const total = body.total || 0;
    const customerText = body.customerText || '';
    const source = body.source || 'web';

    const msg = [
      '🧾 Новый заказ',
      `Источник: ${source}`,
      customerText ? `Сообщение клиента:\n${customerText}` : '',
      lines.length ? `\nПозиции:\n${lines.join('\n')}` : '',
      `\nИтого: ${Number(total || 0).toLocaleString('ru-RU')} ₽`,
      body.createdAt ? `Время: ${body.createdAt}` : ''
    ].filter(Boolean).join('\n');

    let telegram = null;
    if (token && chatId) {
      const tgResp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: msg })
      });
      telegram = await tgResp.json();
      if (!tgResp.ok || !telegram.ok) {
        throw new Error(`Telegram error: ${JSON.stringify(telegram)}`);
      }
    }

    const forwardUrl = process.env.ORDER_FORWARD_URL;
    if (forwardUrl) {
      const headers = { 'content-type': 'application/json' };
      if (process.env.ORDER_FORWARD_TOKEN) headers['authorization'] = `Bearer ${process.env.ORDER_FORWARD_TOKEN}`;
      await fetch(forwardUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    }

    res.status(200).json({ ok: true, telegram: !!telegram });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || 'Server error' });
  }
}
