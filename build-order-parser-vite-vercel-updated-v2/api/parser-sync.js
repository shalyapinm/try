export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.method === 'POST' ? (req.body || {}) : {};
    const sourceUrl = body.sourceUrl || process.env.PARSER_SOURCE_URL;
    const webhookUrl = body.webhookUrl || process.env.PARSER_WEBHOOK_URL;
    const token = body.token || process.env.PARSER_TOKEN || '';
    const triggeredBy = body.triggeredBy || 'vercel-cron';

    if (!sourceUrl) return res.status(400).json({ error: 'sourceUrl / PARSER_SOURCE_URL is required' });
    if (!webhookUrl) return res.status(400).json({ error: 'webhookUrl / PARSER_WEBHOOK_URL is required' });

    const srcResp = await fetch(sourceUrl, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!srcResp.ok) throw new Error(`Source HTTP ${srcResp.status}`);
    const contentType = srcResp.headers.get('content-type') || '';
    const raw = await srcResp.text();

    const payload = {
      sourceUrl,
      contentType,
      fetchedAt: new Date().toISOString(),
      triggeredBy,
      raw,
      // При необходимости можно добавить парсинг HTML/CSV на backend вашего сайта
      // и здесь передавать уже нормализованные позиции.
    };

    const whResp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!whResp.ok) throw new Error(`Webhook HTTP ${whResp.status}`);

    return res.status(200).json({
      ok: true,
      message: 'Ассортимент выгружен из источника и отправлен в webhook',
      bytes: raw.length,
      contentType,
      triggeredBy
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unknown error' });
  }
}
