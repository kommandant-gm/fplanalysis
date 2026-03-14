# FPL Analysis System

A local-first Fantasy Premier League analysis app with:
- `server`: Node.js + Express + MySQL
- `client`: React + Vite + Tailwind

## Tech Stack
- Backend: Express, mysql2, axios, node-cron
- Frontend: React, Vite, Tailwind, axios
- Database: MySQL 8+

## Repository Layout
- `client/`: React frontend
- `server/`: Express API, sync logic, cron jobs
- `database/schema.sql`: Base schema for local DB
- `package.json`: convenience `dev` script for client + server

## Prerequisites
- Node.js 20+ (Node.js 22 also works)
- npm 9+
- MySQL 8+

## Local Setup (Recommended)

### 1. Clone the repository
```bash
git clone <your-repo-url>
cd fplanalysis
```

### 2. Install dependencies
Install root helper dependencies and both app packages:
```bash
npm install
npm install --prefix server
npm install --prefix client
```

### 3. Create database and import schema
This project expects a MySQL database and tables from `database/schema.sql`.

```bash
mysql -u root -p < database/schema.sql
```

By default, this creates/uses database `fpl_analysis`.

### 4. Configure backend environment
Create `server/.env` from example:

Windows PowerShell:
```powershell
Copy-Item server/.env.example server/.env
```

macOS/Linux:
```bash
cp server/.env.example server/.env
```

Edit `server/.env`:
```env
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=yourpassword
DB_NAME=fpl_analysis
```

### 5. Run the app
Option A: run both from repo root
```bash
npm run dev
```

Option B: run separately
```bash
npm run dev --prefix server
npm run dev --prefix client
```

### 6. Open the app
- Frontend: `http://localhost:3000`
- API health: `http://localhost:5000/api/health`

## First Data Sync
After UI loads, click `Sync FPL Data`.

Or call API directly:
```bash
curl -X POST http://localhost:5000/api/sync
```

## Useful API Endpoints
- `GET /api/health`
- `GET /api/players`
- `GET /api/predictions/transfers`
- `GET /api/predictions/captain?gw=<number>`
- `GET /api/fixtures/upcoming`
- `POST /api/sync`
- `POST /api/sync/light`
- `GET /api/sync/status`

Base URL (local): `http://localhost:5000`

## Common Local Issues

### 1. `ECONNREFUSED` (MySQL)
The server cannot connect to DB.
- Check MySQL is running.
- Check `server/.env` host/port/user/password.
- Verify DB name matches imported schema DB.

### 2. `Table '...players' doesn't exist`
Schema was not imported.
- Re-run:
```bash
mysql -u root -p < database/schema.sql
```

### 3. Frontend loads but API calls fail
- Confirm backend is running on port `5000`.
- Confirm `http://localhost:5000/api/health` returns status ok.

### 4. `Cannot GET /` on backend URL
Expected behavior. Backend serves API routes under `/api/*`.

## Security Notes
- Do not commit `.env` files.
- Keep only `.env.example` in git.
- If any secret was committed previously, rotate it.

## Optional Deployment
Railway deployment is optional and not required for contributors.
If needed, keep deployment instructions in a separate file (for example `DEPLOY_RAILWAY.md`) so this README stays local-first.
