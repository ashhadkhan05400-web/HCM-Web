# HCM Lite (React + Vite + Firebase)

## Run
1. Firebase console: create project, enable **Authentication → Email/Password** and **Firestore**.
2. Add a Web app, copy keys into `.env` (see `.env.example`).
3. Deploy rules: `npm i -g firebase-tools && firebase login && firebase deploy --only firestore:rules`
4. `npm install && npm run dev`
5. First visit shows **first-run setup** (company + Admin account). Admin adds departments, designations, holidays, HR logins. HR registers employees (temp password, forced change on first sign-in).

## AI assistant
Get a free key at console.groq.com and add `AI_API_KEY=...` to `.env` (no VITE_ prefix, so it stays server-side). `npm run dev` serves `/api/ai` locally; on Vercel, `api/ai.js` is deployed automatically (set the same env vars there).
Any OpenAI-compatible provider works via `AI_BASE_URL` / `AI_MODEL`.

## Deploy
`npm run build && firebase deploy --only hosting`

## Access control
All role/data-scope checks live in `firestore.rules` (server-side). Employees can only read rows with their own `empId`; payroll finalize is Admin-only; audit log is append-only and Admin-readable.

## Done
AI chat with tools, dashboard summary, smart leave form, policy Q&A.
Setup, login/roles, org setup, HR logins, employees, web check-in/out, corrections, leave (overlap + balance + working days), approval inbox, payroll draft/finalize/lock, payslip PDF, KPIs dashboards, announcements, notifications, audit log.

## Not done yet
CSV import/export, charts/trends, camera attendance.
