# TLS Service SPB

Сайт записи и кабинет заявок для **TLS Service SPB** (Санкт-Петербург).

## Запуск локально

```bash
npm install
npm run dev
```

- сайт: http://127.0.0.1:5173/
- кабинет: http://127.0.0.1:5173/admin.html

## Продакшен (один процесс)

```bash
npm install
npm run build
set NODE_ENV=production
npm start
```

Сервер отдаёт и API, и собранный сайт из `dist/`.

Скопируйте `.env.example` → `.env` и смените пароли до первого запуска.

## Docker

```bash
docker build -t tls-service-spb .
docker run --rm -p 8788:8788 --env-file .env -v tls-data:/app/data tls-service-spb
```

## Доступы по умолчанию (только для локального демо)

| Логин      | Пароль        | Роль     |
| ---------- | ------------- | -------- |
| `admin`    | `admin123`    | админ    |
| `operator` | `operator123` | оператор |

В проде задайте `ADMIN_PASSWORD` / `OPERATOR_PASSWORD` через окружение.

Оператор: ООО «ТЛС-СЕРВИС», ИНН 7811795417.
