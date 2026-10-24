import { initializeApp, getApps, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const cfg = {
  apiKey: import.meta.env.VITE_FB_API_KEY,
  authDomain: import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FB_PROJECT_ID,
  appId: import.meta.env.VITE_FB_APP_ID,
}

export const app = getApps().length ? getApps()[0] : initializeApp(cfg)
export const auth = getAuth(app)
export const db = getFirestore(app)

// Creates a login without signing the current HR/Admin out (uses a second app instance).
export async function createLogin(email, password) {
  const existing = getApps().find(a => a.name === 'sec')
  const sec = existing || initializeApp(cfg, 'sec')
  const sa = getAuth(sec)
  try {
    const c = await createUserWithEmailAndPassword(sa, email, password)
    await signOut(sa)
    return c.user.uid
  } finally {
    if (!existing) {
      try { await deleteApp(sec) } catch {}
    }
  }
}