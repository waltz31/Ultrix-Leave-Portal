# Deploy: Vercel (frontend) + Render (API) + Supabase (database)

The React app is a static Vite site. The Express API runs as a Node service.
Supabase provides PostgreSQL. Local development can keep using SQLite.

```
Browser  →  Vercel (client)
                │
                │  VITE_API_URL
                ▼
         Render Web Service (server)
                │
                │  DATABASE_URL
                ▼
              Supabase Postgres
```

Deploy **API first**, then the frontend. You need the Render URL before the Vercel build.

Both hosts pull from GitHub, so push this repo first.

## 0. Push to GitHub

If the project is not on GitHub yet:

```bash
git init
git add .
git commit -m "Prepare Vercel + Render deploy"
# create a repo on github.com, then:
git remote add origin https://github.com/YOUR_USER/Ultrix-Leave-Portal.git
git branch -M main
git push -u origin main
```

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and paste / run `server/src/schema.pg.sql`.
3. **Project Settings → Database → Connection string**.
   - Use **URI**.
   - Prefer the **Transaction pooler** (port `6543`) for Render.
   - Replace `[YOUR-PASSWORD]` with the database password.
4. Copy the URI. It looks like:

```
postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:6543/postgres
```

## 2. API on Render

1. [dashboard.render.com](https://dashboard.render.com) → **New → Web Service** → connect this GitHub repo.
2. Settings (do **not** leave these as Render defaults — Yarn + Node 26 will fail):

   | Field | Value |
   |-------|--------|
   | **Root Directory** | `server` |
   | **Runtime** | Node |
   | **Node Version** | `22` (Environment → `NODE_VERSION=22`) |
   | **Build Command** | `npm install --omit=optional` (not `yarn`) |
   | **Start Command** | `npm start` |
   | **Instance** | Free is fine to start |

3. Environment variables:

   | Key | Value |
   |-----|--------|
   | `DATABASE_URL` | Supabase URI from step 1 (**required** in production) |
   | `DATABASE_SSL` | `true` |
   | `JWT_SECRET` | long random string |
   | `CLIENT_ORIGIN` | `https://YOUR-APP.vercel.app` (set after Vercel exists; comma-separated if you also have a custom domain) |
   | `APP_PUBLIC_URL` | same as `CLIENT_ORIGIN` |
   | `TZ` | `Asia/Kolkata` |
   | `NODE_ENV` | `production` |
   | `NODE_VERSION` | `22` |

   Optional mail: `MAIL_ENABLED`, `SMTP_*`, `MAIL_FROM` (see `server/.env.example`).

4. Deploy. Copy the service URL, e.g. `https://ultrix-leave-api.onrender.com` (no trailing slash).
5. Check `https://YOUR-API.onrender.com/api/health` — you should see `{ "ok": true, ... }`.

6. Seed the HR user **once** from your machine (needs `DATABASE_URL`):

```bash
cd server
DATABASE_URL='postgresql://...' npm run seed
```

Login: `hr@ultrix.co` — change the default password immediately after first sign-in.

Render’s free web service sleeps after idle time. The first request after sleep can take 30–60s.

## 3. Frontend on Vercel

1. [vercel.com/new](https://vercel.com/new) → import the same GitHub repo.
2. Settings:

   | Field | Value |
   |-------|--------|
   | **Framework Preset** | Vite |
   | **Root Directory** | `client` (click Edit) |
   | **Build Command** | `npm run build` |
   | **Output Directory** | `dist` |
   | **Install Command** | `npm install` |

3. Environment variable — set **before** the first production build:

   | Key | Environment | Value |
   |-----|-------------|--------|
   | `VITE_API_URL` | Production | `https://ultrix-leave-portal.onrender.com` (no trailing slash) |

   Vite bakes this in at **build** time. If you change the Render URL later, update the env var and **Redeploy**.

4. Deploy. Copy the URL, e.g. `https://ultrix-leave-portal.vercel.app`.

5. Back on Render, set `CLIENT_ORIGIN` and `APP_PUBLIC_URL` to that Vercel URL, then **Manual Deploy → Deploy latest commit**.

`client/vercel.json` already rewrites unknown paths to `index.html` so React Router works.

## 4. Custom domain (optional)

- Vercel: **Project → Settings → Domains** → add `leave.yourcompany.com`.
- Then add that origin on Render, e.g.  
  `CLIENT_ORIGIN=https://leave.yourcompany.com,https://ultrix-leave-portal.vercel.app`

## Local development

Leave `DATABASE_URL` unset. The API uses SQLite in `server/data/leave.db`.

```bash
npm run install:all
npm run dev:server   # http://localhost:4000
npm run dev:client   # http://localhost:5173  (proxies /api)
```

To run locally against Supabase, put `DATABASE_URL` in `server/.env`.
