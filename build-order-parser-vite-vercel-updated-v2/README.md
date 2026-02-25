# build-order-parser (updated)

## Что добавлено
- Голосовой ввод заявки (Chrome / Android / desktop, Web Speech API)
- Отправка разобранного заказа в ваш сайт/API по webhook (POST JSON)
- Блок интеграции для parser-sync
- Vercel cron для запуска 2 раза в день (09:00 и 14:00 по Москве)
- Serverless endpoint `/api/parser-sync` для автоматической синхронизации ассортимента
- Сохранение настроек (URL таблицы / webhook) в localStorage

## Что умеет
- Загрузка ассортимента из Google Sheets / Excel / CSV
- Разбор "грязного" текста заявки (с учетом размеров в названии)
- Нечеткое сопоставление номенклатуры
- Черновик заказа
- Копирование черновика
- Экспорт заказа в Excel
- Фильтр по нераспознанным / низкой уверенности
- Отправка заказа в API сайта

## Локальный запуск
```bash
npm install
npm run dev
```

## Деплой на Vercel
1. Загрузите проект в GitHub
2. Vercel → Add New → Project
3. Выберите репозиторий
4. В Project Settings → Environment Variables задайте (рекомендуется):
   - `PARSER_SOURCE_URL` — откуда брать прайс/каталог (csv/json/html)
   - `PARSER_WEBHOOK_URL` — куда отправлять обновление ассортимента
   - `PARSER_TOKEN` — опционально
5. Deploy

## Как подключить ваш backend для приема заказов
Сделайте endpoint (например `/api/orders`) и принимайте POST JSON.
UI отправляет:
- `dirtyText`
- `orderText`
- `total`
- `lines[]` с SKU/наименованием/ценой/qty/confidence

## Замечание по cron
В `vercel.json` cron задан в UTC:
- `06:00 UTC` = `09:00 MSK`
- `11:00 UTC` = `14:00 MSK`


## Прием заказов прямо на Vercel (без отдельного сервера)
В проект добавлен endpoint `POST /api/orders`.
Это значит, что после деплоя на Vercel UI может отправлять заказы **внутрь этого же проекта** (по умолчанию уже стоит `/api/orders`).

### Что делает `/api/orders`
- принимает JSON заказа из интерфейса
- отправляет уведомление в Telegram (если настроены переменные)
- при необходимости дублирует заказ во внешний CRM/1С/webhook (`ORDER_FORWARD_URL`)
- возвращает статус приема

### Обязательные/полезные ENV (Vercel → Project Settings → Environment Variables)
Для Telegram уведомлений:
- `TELEGRAM_BOT_TOKEN` — токен бота
- `TELEGRAM_CHAT_ID` — ID чата/группы куда слать заказ

Опционально (защита endpoint):
- `ORDER_API_KEY` — если задан, endpoint потребует заголовок `x-api-key`

Опционально (пересылка в ваш сайт/CRM):
- `ORDER_FORWARD_URL` — внешний webhook
- `ORDER_FORWARD_TOKEN` — Bearer token для внешнего webhook

### Быстрый запуск Telegram
1. Создайте бота через BotFather
2. Добавьте бота в ваш чат/группу
3. Получите `chat_id`
4. Добавьте `TELEGRAM_BOT_TOKEN` и `TELEGRAM_CHAT_ID` в Vercel
5. Redeploy

После этого заказ из UI будет приходить в Telegram даже без отдельного backend-сервера.
