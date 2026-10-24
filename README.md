
# HCM Lite

Lightweight Human Capital Management for small teams. Attendance, leave, payroll, and an AI assistant, all in one web app.

**Live:** [hcm-web-bice.vercel.app](https://hcm-web-bice.vercel.app/)
---

## Features

- **First-run setup:** create your company and Admin account in minutes
- **Roles:** Admin, HR, Employee, each with their own data scope
- **Org setup:** departments, designations, holidays, HR logins
- **Employees:** HR registers staff with a temp password (forced change on first sign-in)
- **Attendance:** web check-in/out and correction requests
- **Leave:** overlap check, balance check, working-day calculation
- **Approvals:** one inbox for leave and corrections
- **Payroll:** draft, finalize, lock, plus payslip PDF
- **Dashboards:** KPIs per role
- **Extras:** announcements, notifications, append-only audit log
- **AI assistant:** chat with tools, dashboard summary, smart leave form, policy Q&A

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React + Vite |
| Auth and DB | Firebase Authentication (Email/Password) + Firestore |
| Serverless | Vercel function (`api/ai.js`) |
| AI | Groq (any OpenAI-compatible provider works) |
| Hosting | Vercel or Firebase Hosting |

## Getting Started

### 1. Firebase

1. Create a project in the [Firebase console](https://console.firebase.google.com).
2. Enable **Authentication → Email/Password** and **Firestore**.
3. Add a Web app and copy its config.

### 2. Environment variables

Create a `.env` file in the project root:

```env
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=

# AI assistant (no VITE_ prefix, stays server-side)
AI_API_KEY=
# Optional
AI_BASE_URL=
AI_MODEL=
```

Get a free AI key at [console.groq.com](https://console.groq.com).

### 3. Deploy Firestore rules

```bash
npm i -g firebase-tools
firebase login
firebase deploy --only firestore:rules
```

### 4. Run

```bash
npm install
npm run dev
```

`npm run dev` also serves `/api/ai` locally.

### 5. First visit

The app opens a **first-run setup**: enter your company and create the Admin account. Then:

1. Admin adds departments, designations, holidays, and HR logins.
2. HR registers employees.

## Deployment

### Vercel

1. Import the repo into Vercel.
2. Add **all** variables from `.env` under **Settings → Environment Variables**.
3. **Redeploy.** Variables only apply to new builds.
4. In Firebase → Authentication → Settings → **Authorized domains**, add your Vercel domain.

`api/ai.js` is deployed automatically as a serverless function.

### Firebase Hosting

```bash
npm run build && firebase deploy --only hosting
```

## Security

All role and data-scope checks live in `firestore.rules`, enforced server-side.

- Employees can only read rows with their own `empId`
- Payroll finalize is Admin-only
- Audit log is append-only and Admin-readable

## Project Structure

```
├── api/              # Vercel serverless functions (AI endpoint)
├── src/              # React app
├── firestore.rules   # Access control
├── firebase.json     # Firebase config
├── vite.config.js
└── index.html
```

## Roadmap

- [ ] CSV import/export
- [ ] Charts and trends
- [ ] Camera attendance

## Author

Built by [Ashhad Khan](https://github.com/ashhadkhan05400-web).
