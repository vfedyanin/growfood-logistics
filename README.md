# GrowFood Magistral — TMS

Транспортная система управления магистральной логистикой GrowFood: справочники,
заявки на перевозку, рейсы с экономикой, аналитический дашборд, поддержка LaaS.

## Стек

- **Next.js 14** (App Router, server actions) + TypeScript
- **Prisma** ORM + **Neon** (PostgreSQL, ветвление БД)
- **Ant Design v6** + **Recharts**
- **NextAuth** (роли/права, RBAC на уровне таблиц)
- Деплой — **Vercel** (авто-деплой из GitHub)

## Локальный запуск

```bash
# 1. зависимости
npm install

# 2. переменные окружения
cp .env.example .env
#   и впишите свои значения:
#   DATABASE_URL     — строка подключения к своему Neon dev-бранчу
#   NEXTAUTH_SECRET  — любой случайный секрет (openssl rand -base64 32)
#   NEXTAUTH_URL     — http://localhost:3000

# 3. схема + сид
npx prisma generate
npx prisma db push        # применить схему к своему dev-бранчу
npx prisma db seed        # справочники, роли, демо-данные

# 4. запуск
npm run dev               # http://localhost:3000
```

**Тестовый вход:** `admin@growfood.ru` / `admin123`

## Базы данных (Neon)

- У каждого разработчика **свой dev-бранч** Neon — не работаем на общем.
- **Прод-бранч защищён**, схему на нём меняем только через CI/миграции, не вручную.
- ⚠️ `prisma db push --force-reset` **стирает все данные** — только на своём dev-бранче.

## Рабочий процесс

1. Ветка от `main`: `git checkout -b feature/<краткое-описание>`
2. Коммитим, пушим, открываем **Pull Request**.
3. Vercel автоматически собирает **preview-деплой** на каждый PR.
4. После ревью — merge в `main` → автоматический **прод-деплой**.

Прямой push в `main` и ручной `vercel --prod` не используем.

## Проверка перед PR

```bash
npx tsc --noEmit          # типы
npm run build             # сборка (не запускать при работающем dev-сервере!)
```

## Структура

```
src/app/(protected)/   — страницы (рейсы, заявки, груз, справочники, дашборд, финансы, админка)
src/lib/actions/        — server actions (бизнес-логика)
src/components/          — переиспользуемые UI-компоненты
prisma/schema.prisma     — модель данных
prisma/seed.ts           — сид
```

## Документация

- `SPEC.md` — спецификация продукта
- `TEST_CASES.md` — тест-кейсы
- `CLAUDE.md` — правила работы с ассистентом в проекте
