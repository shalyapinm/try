# build-order-parser (Vercel + Telegram)

## Что добавлено
- Голосовой ввод (Web Speech API, Chrome)
- `/api/orders` — отправка заказа в Telegram
- `/api/parser-sync` — серверная синхронизация ассортимента (CSV / XLSX / JSON / HTML table)
- `vercel.json` cron на **09:00** и **14:00 МСК** (UTC: 06:00 и 11:00)

## Переменные Vercel
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `PARSER_SOURCE_URL` (опционально, URL прайса/таблицы для cron)
- `ORDER_FORWARD_URL` (опционально)
- `ORDER_FORWARD_TOKEN` (опционально)

## Локально
```bash
npm install
npm run dev
```

## Деплой
1. Залить в GitHub
2. Подключить к Vercel
3. Добавить env-переменные
4. Redeploy
