import { useState } from 'react'
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword, updatePassword } from 'firebase/auth'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { Clock, Eye, EyeOff, Sparkles, Wallet } from 'lucide-react'
import { auth, db } from './firebase'
import { F } from './ui'

const nice = c => ({
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/invalid-email': 'That email address looks wrong.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes or reset your password.',
  'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/weak-password': 'Use at least 6 characters.',
  'auth/network-request-failed': 'No internet connection.',
  'auth/requires-recent-login': 'Sign out and sign in again, then retry.',
}[c] || 'Something went wrong. Please try again.')

const PW = ({ l, ...p }) => {
  const [show, setShow] = useState(false)
  return (
    <label>
      {l}
      <span className="pw">
        <input type={show ? 'text' : 'password'} {...p} />
        <button type="button" aria-label="Show password" onClick={() => setShow(!show)}>
          {show ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </span>
    </label>
  )
}

export function AuthPage({ setup }) {
  const [tab, setTab] = useState(setup ? 'up' : 'in')
  const [f, setF] = useState({})
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const reset = () => { setErr(''); setOk('') }

  const signIn = async e => {
    e.preventDefault()
    reset()
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, f.email, f.pw)
    } catch (x) {
      setErr(nice(x.code))
      setBusy(false)
    }
  }

  const forgot = async () => {
    reset()
    if (!f.email) return setErr('Type your email above first.')
    try {
      await sendPasswordResetEmail(auth, f.email)
      setOk('Reset link sent. Check your inbox and spam folder.')
    } catch (x) {
      setErr(nice(x.code))
    }
  }

  const signUp = async e => {
    e.preventDefault()
    reset()
    setBusy(true)
    try {
      const c = await createUserWithEmailAndPassword(auth, f.email, f.pw)
      await setDoc(doc(db, 'users', c.user.uid), {
        email: f.email,
        name: f.name,
        role: 'admin',
        active: true,
        mustChangePassword: false,
      })
      await setDoc(doc(db, 'settings', 'company'), {
        name: f.company,
        start: '09:00',
        grace: 15,
        half: 5,
        weekend: [0, 6],
        lat: null,
        lng: null,
        radius: 150,
      })
      for (const [id, name, quota] of [
        ['annual', 'Annual', 14],
        ['sick', 'Sick', 8],
        ['casual', 'Casual', 10],
        ['unpaid', 'Unpaid', null],
      ]) {
        await setDoc(doc(db, 'leaveTypes', id), { name, quota })
      }
      await setDoc(doc(db, 'meta', 'init'), { done: true })
      window.location.href = '/'
    } catch (x) {
      setErr(nice(x.code))
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="art">
        <div className="brand"><i>H</i>HCM Lite</div>
        <div>
          <h2>People, time and pay in one place.</h2>
          <ul>
            <li><Clock size={20} />Check in, apply for leave and see your balance. Each role sees only its own data.</li>
            <li><Sparkles size={20} />Ask the AI assistant who is late, who is on leave, or how much leave you have left.</li>
            <li><Wallet size={20} />Monthly payroll with tax and downloadable payslips.</li>
          </ul>
        </div>
        <small>Saylani Hackathon · 24 October 2026</small>
      </div>
      <div className="formside">
        <div className="formbox">
          <div className="tabs">
            <button className={tab === 'in' ? 'on' : ''} onClick={() => { setTab('in'); reset() }}>Sign in</button>
            <button className={tab === 'up' ? 'on' : ''} onClick={() => { setTab('up'); reset() }}>Sign up</button>
          </div>

          {tab === 'in' && (
            <>
              <h1>Welcome back</h1>
              <p>Sign in with your work email.</p>
              <form onSubmit={signIn}>
                <F l="Email" type="email" autoComplete="email" required value={f.email || ''} onChange={set('email')} />
                <PW l="Password" autoComplete="current-password" required value={f.pw || ''} onChange={set('pw')} />
                <button type="button" className="link" onClick={forgot}>Forgot password?</button>
                {err && <div className="msg">{err}</div>}
                {ok && <div className="ok">{ok}</div>}
                <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
              </form>
            </>
          )}

          {tab === 'up' && setup && (
            <>
              <h1>Create your company</h1>
              <p>This first account becomes the Admin.</p>
              <form onSubmit={signUp}>
                <F l="Company name" required value={f.company || ''} onChange={set('company')} />
                <F l="Your name" required value={f.name || ''} onChange={set('name')} />
                <F l="Email" type="email" required value={f.email || ''} onChange={set('email')} />
                <PW l="Password (min 6)" minLength={6} required value={f.pw || ''} onChange={set('pw')} />
                {err && <div className="msg">{err}</div>}
                <button disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
              </form>
            </>
          )}

          {tab === 'up' && !setup && (
            <>
              <h1>Need an account?</h1>
              <p>
                Accounts are created for you. Your Admin creates HR logins, and HR registers employees.
                Ask them for your email and temporary password, then sign in. You will choose a new password on first sign-in.
              </p>
              <button onClick={() => setTab('in')}>Back to sign in</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function ChangePw({ uid }) {
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const go = async e => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      await updatePassword(auth.currentUser, pw)
      await updateDoc(doc(db, 'users', uid), { mustChangePassword: false })
    } catch (x) {
      setErr(nice(x.code))
      setBusy(false)
    }
  }

  return (
    <div className="center card">
      <h1>Choose a new password</h1>
      <p style={{ color: 'var(--mute)' }}>Your temporary password must be changed before you continue.</p>
      <form onSubmit={go}>
        <PW l="New password (min 6)" minLength={6} required value={pw} onChange={e => setPw(e.target.value)} />
        {err && <div className="msg">{err}</div>}
        <button disabled={busy || pw.length < 6}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </div>
  )
}