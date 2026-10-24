import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { Building2, CalendarDays, Clock, FileText, LayoutDashboard, LogOut, Megaphone, ScrollText, Users, Wallet } from 'lucide-react'
import { where } from 'firebase/firestore'
import { auth } from './firebase'
import { useApp } from './ctx'
import { AuthPage, ChangePw } from './auth'
import { Dashboard, Announcements, Audit } from './admin'
import { Org, Employees } from './hr'
import { Attendance, Leave } from './employee'
import { Payroll, Payslips } from './payments'
import AIChat from './AIChat'
import { useCol } from './lib'

const ICON = {
  '/': LayoutDashboard,
  '/org': Building2,
  '/employees': Users,
  '/attendance': Clock,
  '/leave': CalendarDays,
  '/payroll': Wallet,
  '/payslips': FileText,
  '/news': Megaphone,
  '/audit': ScrollText
}

const NAV = {
  admin: [
    ['/', 'Dashboard'],
    ['/org', 'Organization'],
    ['/employees', 'Employees'],
    ['/attendance', 'Attendance'],
    ['/leave', 'Leave'],
    ['/payroll', 'Payroll'],
    ['/payslips', 'Payslips'],
    ['/news', 'Announcements'],
    ['/audit', 'Audit log']
  ],
  hr: [
    ['/', 'Dashboard'],
    ['/employees', 'Employees'],
    ['/attendance', 'Attendance'],
    ['/leave', 'Leave'],
    ['/payroll', 'Payroll'],
    ['/payslips', 'Payslips'],
    ['/news', 'Announcements']
  ],
  employee: [
    ['/', 'Dashboard'],
    ['/attendance', 'Attendance'],
    ['/leave', 'Leave'],
    ['/payslips', 'Payslips'],
    ['/news', 'Announcements']
  ]
}

const Skeleton = () => (
  <div className="shell">
    <nav>
      <div className="brand"><i>H</i>HCM Lite</div>
      <small>&nbsp;</small>
      {[0, 1, 2, 3, 4, 5].map(i => (
        <div key={i} className="sk" style={{ height: 36, margin: '4px 0', opacity: 0.15 }} />
      ))}
    </nav>
    <main>
      <div className="sk" style={{ height: 32, width: 280, marginBottom: 24 }} />
      <div className="kpis">
        {[0, 1, 2, 3].map(i => <div key={i} className="sk" style={{ height: 88 }} />)}
      </div>
      <div className="sk" style={{ height: 220, marginTop: 24 }} />
    </main>
  </div>
)

export default function App() {
  const { loading, setup, user, settings } = useApp()

  const allNotes = useCol(
    'notifications',
    user?.role === 'employee' ? [where('toUid', '==', user.uid)] : [],
    (user?.uid || '') + '-notes'
  )

  const unreadCount = user?.role === 'employee'
    ? allNotes.filter(n => n.read !== true).length
    : 0

  if (loading) return <Skeleton />
  if (!user) return <AuthPage setup={setup} />
  if (user.mustChangePassword) return <ChangePw uid={user.uid} />
  if (!user.active) {
    return (
      <div className="center card">
        <h1>Login deactivated</h1>
        <p>Ask your Admin to activate it.</p>
        <button onClick={() => signOut(auth)}>Sign out</button>
      </div>
    )
  }

  const role = user.role || 'employee'
  const links = NAV[role] || NAV.employee

  return (
    <div className="shell">
      <nav>
        <div className="brand"><i>H</i>HCM Lite</div>
        <small>{settings?.name || 'Company'}</small>

        {links.map(([to, t]) => {
          const Ic = ICON[to]
          const showBadge = to === '/' && role === 'employee' && unreadCount > 0

          return (
            <NavLink key={to} to={to} end={to === '/'}>
              <Ic size={18} />
              {t}
              {showBadge && (
                <span style={{
                  marginLeft: 'auto',
                  background: '#e74c3c',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  minWidth: 18,
                  height: 18,
                  borderRadius: 99,
                  display: 'grid',
                  placeItems: 'center',
                  padding: '0 5px'
                }}>
                  {unreadCount}
                </span>
              )}
            </NavLink>
          )
        })}

        <div className="me">
          <b>{user.name?.[0]?.toUpperCase() || '?'}</b>
          <div>
            {user.name}
            <span>{role}</span>
          </div>
          <button title="Sign out" aria-label="Sign out" onClick={() => signOut(auth)}>
            <LogOut size={18} />
          </button>
        </div>
      </nav>

      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          {role === 'admin' && <Route path="/org" element={<Org />} />}
          {role !== 'employee' && <Route path="/employees" element={<Employees />} />}
          {role !== 'employee' && <Route path="/payroll" element={<Payroll />} />}
          {role === 'admin' && <Route path="/audit" element={<Audit />} />}
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/leave" element={<Leave />} />
          <Route path="/payslips" element={<Payslips />} />
          <Route path="/news" element={<Announcements />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <AIChat />
    </div>
  )
}