# FPL Analysis System

Stack: Node.js + Express + MySQL (server) · React + Vite + Tailwind (client)

---

## Setup

### 1. MySQL — run the schema
```bash
mysql -u root -p < database/schema.sql
```

### 2. Server setup
```bash
cd server
cp .env.example .env
# Edit .env with your MySQL credentials
npm install
npm run dev
```

### 3. Client setup
```bash
cd client
npm install
npm run dev
```

### 4. First sync (pull FPL data)
Visit http://localhost:3000 and click **"Sync FPL Data"**
Or call the API directly:
```bash
curl -X POST http://localhost:5000/api/sync
```

---

## URLs
| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Backend API | http://localhost:5000/api |
| Health check | http://localhost:5000/api/health |

## API Endpoints
| Endpoint | Description |
|----------|-------------|
| POST /api/sync | Pull fresh FPL data & run predictions |
| GET /api/players | All players with predictions |
| GET /api/players?pos=MID | Filter by position |
| GET /api/predictions/top?gw=30 | Top predicted players for a GW |
| GET /api/predictions/transfers | Suggested transfers |
| GET /api/predictions/captain?gw=30 | Captain recommendations |
| GET /api/fixtures?gw=30 | Fixtures for a gameweek |

---

## Weekly maintenance
Every Thursday after FPL updates, either:
- Click "Sync FPL Data" in the dashboard, or
- The cron job runs automatically at 8am Thursday

---

## Folder structure
```
fpl-analysis/
├── server/
│   ├── index.js          ← Express entry point + cron
│   ├── config/db.js      ← MySQL pool
│   ├── routes/           ← API routes
│   └── services/
│       └── fplFetcher.js ← FPL API fetcher + prediction engine
├── client/
│   └── src/
│       ├── App.jsx        ← Routing
│       └── pages/         ← Dashboard, Players, Transfers, Captain
└── database/
    └── schema.sql         ← Run this first
```
