# Health Centre

A premium personal health dashboard that pulls data from Garmin Connect and displays four core metrics — **Sleep**, **Recovery**, **Strain**, and **Calories** — calculated using science-backed algorithms and your own 30-day personal baselines.

Built as a PWA for iPhone (iOS Safari), it feels like a native app — instant load, offline support, bottom tab navigation, and pull-to-refresh.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS, shadcn/ui, Framer Motion, Recharts |
| Backend | Python 3.11+, FastAPI, garminconnect |
| Storage | SQLite (local, 90 days history) |
| Deployment | Vercel (frontend) + local FastAPI server |

---

## Getting started

### 1. Clone the repo

```bash
git clone https://github.com/owilson123/health-centre.git
cd health-centre
```

### 2. Set environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
GARMIN_EMAIL=your_garmin_email@example.com
GARMIN_PASSWORD=your_garmin_password
BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

### 3. Install frontend dependencies

```bash
npm install
```

### 4. Set up the Python backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 5. Run the backend

```bash
cd backend
uvicorn main:app --reload --port 8000
```

The backend will:
- Initialise the SQLite database on first run
- Auto-sync 90 days of Garmin data on first dashboard load
- Refresh data when last sync was >30 minutes ago

### 6. Run the frontend

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploying to Vercel

1. Push the repo to GitHub (already done).
2. Import the project in [vercel.com](https://vercel.com) — it will auto-detect Next.js.
3. Add environment variables in the Vercel dashboard:
   - `BACKEND_URL` — the URL of your running FastAPI instance (e.g. a VPS, Fly.io, or Railway deployment)
4. Deploy.

The FastAPI backend must be hosted separately and accessible over HTTPS for the Vercel frontend to reach it.

---

## PWA installation on iPhone

1. Open the app in iOS Safari.
2. Tap the Share button → **Add to Home Screen**.
3. Tap **Add**.

The app will launch in standalone mode (no browser chrome), with a dark status bar and safe area insets respected.

---

## Metric algorithms

### Sleep Score (0–100)
Weighted composite: Duration (20%), Efficiency (15%), Deep sleep % (20%), REM % (20%), Awake time penalty (10%), HRV vs 30-day baseline (10%), Resting HR vs baseline (5%).

### Recovery Score (0–100)
HRV z-score vs 30-day baseline (35%), Resting HR vs baseline (25%), Sleep score (20%), Body Battery start-of-day (10%), Previous day stress inverted (10%). ACWR penalty applied if training load is out of range.

### Strain Score (0–100)
Exponential HR zone weighting (Z1=1×, Z2=2×, Z3=4×, Z4=8×, Z5=16×) × activity type multiplier, normalised to 0–100. Training Effect used as secondary signal.

### Calories
Mifflin-St Jeor BMR + Garmin active calories. BMR pro-rated to time of day for current-day predictions. 7-day rolling average tracked.

---

## Project structure

```
health-centre/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── page.tsx            # Overview / home
│   │   ├── sleep/page.tsx
│   │   ├── activities/page.tsx
│   │   ├── calories/page.tsx
│   │   └── trends/page.tsx
│   ├── components/
│   │   ├── layout/BottomNav.tsx
│   │   ├── ui/                 # ScoreRing, GlassCard, etc.
│   │   └── charts/             # Recharts wrappers
│   └── lib/                    # Types, API client, hooks, utils
├── backend/
│   ├── main.py                 # FastAPI app + endpoints
│   ├── garmin_sync.py          # Garmin Connect data fetcher
│   ├── metrics.py              # All score calculations
│   ├── database.py             # SQLite schema + connection
│   └── requirements.txt
└── public/
    ├── manifest.json           # PWA manifest
    └── icons/                  # App icons (replace SVGs with PNGs)
```

---

## Icon assets

SVG placeholder icons are in `public/icons/`. For production, convert them to PNG at the correct sizes (120×120, 152×152, 180×180, 192×192, 512×512) using a tool like Inkscape, Figma, or `sharp`:

```bash
npm install -g sharp-cli
sharp -i public/icons/apple-touch-icon-180.svg -o public/icons/apple-touch-icon-180.png resize 180 180
```

---

## Environment variables

| Variable | Description |
|---|---|
| `GARMIN_EMAIL` | Your Garmin Connect email |
| `GARMIN_PASSWORD` | Your Garmin Connect password |
| `BACKEND_URL` | FastAPI server URL (used by Next.js rewrites) |
| `NEXT_PUBLIC_BACKEND_URL` | FastAPI server URL (used by client-side fetch) |
