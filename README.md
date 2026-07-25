# Samo Passport ✈️

**Life is a Journey** — A gamified wellness passport system for medical students.

Students attend wellness activities, scan QR codes, and earn "km" points that accumulate into travel-themed tiers on their digital boarding pass.

## Features

- 🔐 **Google OAuth** — Login restricted to `@kkumail.com` accounts via Supabase Auth
- 📱 **QR Code Scanning** — Dynamic (rotating, anti-cheat) and static (printable) QR codes
- 🎫 **Boarding Pass Dashboard** — Travel-themed passport UI with tier progression and city stamps
- 🛡️ **Admin Terminal** — Create, edit, delete activities and generate QR scanners.
  Access is granted per-ฝ่าย from the SAMO website (ทีม SAMO → จัดการสิทธิ์ → SAMO Passport);
  sign in with the Google account that holds the grant.
- ⭐ **Travel Visa** — Streak bonus for consistent participation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML / CSS / JavaScript (ES Modules) |
| Build Tool | [Vite](https://vitejs.dev/) |
| Backend / Auth | [Supabase](https://supabase.com/) (PostgreSQL + Auth + RLS) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) |
| QR Generation | [qrcodejs](https://github.com/davidshimjs/qrcodejs) |

## Project Structure

```text
passport/
├── index.html              # Landing page (login / continue)
├── html/                   # Application views
│   ├── admin.html          # Admin terminal (CRUD + QR generation)
│   ├── dashboard.html      # Student boarding pass dashboard
│   └── scan.html           # QR scan processor & confirmation
├── css/
│   ├── admin.css           # Admin page styles (toggle, QR layout, cards)
│   ├── main.css            # Global design system (colors, typography, glass effects)
│   ├── passport.css        # Boarding pass dashboard styles
│   └── scan.css            # Scan page styles (spinner, status)
├── js/
│   ├── admin-page.js       # Admin CRUD, QR, season control, leaderboard
│   ├── admin-scope.js      # Who may admin, and which ฝ่าย (ทีม SAMO tree)
│   ├── app.js              # Supabase client initialization
│   ├── auth.js             # Session checking, OAuth error handling, logout
│   ├── certificate.js      # Shared canvas renderer (name drawn on a background)
│   ├── constants.js        # Shared DEPARTMENTS / SUBDEPARTMENTS maps
│   ├── dashboard.js        # Passport book, stamps, flight log, leaderboard, certs
│   ├── index.js            # Landing page logic
│   ├── routes.js           # Centralized routing constants
│   ├── samo.js             # SamoYear/Season helpers (current = open row)
│   ├── scanning.js         # Scan processing, token verification, stamp insertion
│   ├── upload.js           # Drive image upload/delete via the GAS web app
│   └── utils.js            # Shared helpers (UUID, Google Drive URL fixer, localStorage)
├── .env.example            # Template for environment variables
├── .gitignore              # Ignored files and directories for Git
├── package.json            # Project metadata, dependencies, and NPM scripts
├── package-lock.json       # Exact dependency versions tree
└── vite.config.js          # Multi-page Vite build config
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [Supabase](https://supabase.com/) project with the required tables

### Installation

```bash
git clone [https://github.com/samodevmdkku69/passport.git](https://github.com/samodevmdkku69/passport.git)
cd passport
npm install
```

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
VITE_SUPABASE_URL=[https://your-project.supabase.co](https://your-project.supabase.co)
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Run Locally

```bash
npm run dev
```

Opens at `http://localhost:5173`. Hot-reloads on file changes.

### Build for Production

```bash
npm run build
npm run preview   # Preview the production build locally
```

## 🤝 Contributing

We welcome contributions from the SAMO IT team! If you want to add a new feature, fix a bug, or make changes to this repository, **please read our step-by-step Git guide first**:

👉 **[Read the CONTRIBUTING.md guide](./CONTRIBUTING.md)** 👈

Following this workflow ensures that you can safely test your code using Cloudflare Preview deployments without breaking the live app for other medical students.

## Deployment

This project is deployed on **Cloudflare Pages** connected to the GitHub repo.

### Production

Push to `main` branch → Cloudflare auto-builds and deploys to production.

```bash
git add .
git commit -m "your changes"
git push origin main
```

### Preview Deployments (Testing)

Push to **any non-main branch** → Cloudflare creates a preview deployment with a unique URL.

```bash
git checkout -b refactor
git add .
git commit -m "refactor: extract inline scripts to modules"
git push origin refactor
```

After pushing, check your **Cloudflare Pages dashboard** → **Deployments** tab for the preview URL (e.g. `https://refactor.your-project.pages.dev`).

Once tested and verified, merge into main:

```bash
git checkout main
git merge refactor
git push origin main
```

## Admin Access

Default admin credentials (change in production):

- **Username:** `admin`
- **Password:** `1234`

## Database Tables

| Table | Purpose |
|-------|---------|
| `activities` | Activity definitions (name, km, badge, department, sub-department, tokens) |
| `scans` | Records of user scans (user_id, activity_id, points_awarded) |
| `user_tiers` | Computed view of user totals, tiers, and visa status |

## License

Private project — KKU Faculty of Medicine, Samo Wellness Program.