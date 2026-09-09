# TLS Service SPB

Сайт записи и кабинет заявок для **TLS Service SPB** (Санкт-Петербург).

## Запуск локально

```bash
npm install
npm run dev
```

- сайт: http://127.0.0.1:5173/
- кабинет: http://127.0.0.1:5173/admin.html

Пароли **не публикуются**. При первом запуске сервер создаст пользователей и выведет логин/пароль в консоль — сохрани их. Либо задай через `.env` (см. `.env.example`).

## Продакшен (один процесс)

```bash
npm install
npm run build
set NODE_ENV=production
npm start
```

Обязательно задай `ADMIN_PASSWORD` и `OPERATOR_PASSWORD` в окружении. Без них прод не стартует.

Сервер отдаёт и API, и собранный сайт из `dist/`.

## Docker

```bash
docker build -t tls-service-spb .
docker run --rm -p 8788:8788 --env-file .env -v tls-data:/app/data tls-service-spb
```

Оператор: ООО «ТЛС-СЕРВИС», ИНН 7811795417.
