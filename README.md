# Zindagi Prototype

This repo has two apps:

- `server`: Express + Prisma backend
- `mobile`: Expo React Native app

## Prerequisites

- Node.js 20+
- npm
- PostgreSQL database, either local Postgres or Neon
- Expo Go app for testing on a physical phone, or Android Studio / Xcode for emulators

## Server Setup

From the repo root:

```bash
cd server
npm install
```

Create `server/.env`:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
PORT=4000
AUTH_OTP_CODE=1234
AUTH_OTP_TTL_MINUTES=10
AUTH_SESSION_TTL_DAYS=30
```

For Neon, use the connection string from the Neon dashboard. It should include `sslmode=require`, for example:

```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST.neon.tech/DB_NAME?sslmode=require"
```

Generate Prisma client:

```bash
npm run prisma:generate
```

Apply database migrations:

```bash
npm run prisma:migrate
```

Start the backend in development:

```bash
npm run dev
```

The backend runs on:

```text
http://localhost:4000
```

Health check:

```text
http://localhost:4000/health
```

Production build:

```bash
npm run build
npm start
```

For a deployed production database, use:

```bash
npx prisma migrate deploy
```

## Mobile Setup

From the repo root:

```bash
cd mobile
npm install
```

Start Expo:

```bash
npm start
```

Run on Android:

```bash
npm run android
```

Run on iOS:

```bash
npm run ios
```

Run on web:

```bash
npm run web
```

Lint:

```bash
npm run lint
```

## Backend URL For Mobile

The mobile app must point to the backend API URL.

For Android emulator, use:

```text
http://10.0.2.2:4000
```

For iOS simulator, use:

```text
http://localhost:4000
```

For a physical phone, use your computer's LAN IP address:

```text
http://YOUR_LAN_IP:4000
```

Example:

```text
http://192.168.1.20:4000
```

Make sure the backend is running and your phone is on the same network.

## Auth

OTP authentication uses the static code from `server/.env`:

```env
AUTH_OTP_CODE=1234
```

Use `1234` as the OTP unless the env value is changed.
