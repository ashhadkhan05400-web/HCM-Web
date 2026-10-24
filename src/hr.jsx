import { useState } from 'react'
import { sendPasswordResetEmail } from 'firebase/auth'
import { doc, setDoc, updateDoc } from 'firebase/firestore'
import { auth, createLogin, db } from './firebase'
import { useApp } from './ctx'
import { F, ListAdd, Table, Tag } from './ui'
import { audit, useCol, ymd } from './lib'

export function Org() {
  const { settings: s, user } = useApp(), [f, setF] = useState(s), [m, setM] = useState('')
  const set = k => e => setF({ ...f, [k]: e.target.type === 'number' ? +e.target.value : e.target.value })
  const save = async e => { e.preventDefault(); await setDoc(doc(db, 'settings', 'company'), f); audit('update', 'settings', s, f); setM('Saved. Reload to apply.') }
  return <>
    <h1>Organization</h1>
    <form className="card" onSubmit={save}>
      <F l="Company" value={f.name} onChange={set('name')} />
      <F l="Office start" type="time" value={f.start} onChange={set('start')} />
      <F l="Grace (min)" type="number" value={f.grace} onChange={set('grace')} />
      <F l="Half day under (h)" type="number" value={f.half} onChange={set('half')} />
      <F l="Office latitude" type="number" step="any" value={f.lat ?? ''} onChange={set('lat')} />
      <F l="Office longitude" type="number" step="any" value={f.lng ?? ''} onChange={set('lng')} />
      <F l="Radius (m)" type="number" value={f.radius} onChange={set('radius')} />
      <button>Save settings</button>
      {m && <span className="ok">{m}</span>}
    </form>
    <ListAdd col="departments" title="Departments" fields={[{ k: 'name', l: 'Name' }]} show={i => i.name} />
    <ListAdd col="designations" title="Designations" fields={[{ k: 'name', l: 'Name' }]} show={i => i.name} />
    <ListAdd col="leaveTypes" title="Leave types" fields={[{ k: 'name', l: 'Name' }, { k: 'quota', l: 'Yearly quota (blank = unlimited)', type: 'number', optional: true }]} show={i => `${i.name} — ${i.quota ?? 'unlimited'}`} />
    <ListAdd col="holidays" title="Holidays" fields={[{ k: 'date', l: 'Date', type: 'date' }, { k: 'name', l: 'Name' }]} show={i => `${i.date} — ${i.name}`} />
    <HrLogins />
  </>
}

function HrLogins() {
  const users = useCol('users'), [f, setF] = useState({}), [err, setErr] = useState('')
  const add = async e => {
    e.preventDefault(); setErr('')
    try {
      const uid = await createLogin(f.email, f.pw)
      const d = { email: f.email, name: f.name, role: 'hr', active: true, mustChangePassword: true }
      await setDoc(doc(db, 'users', uid), d); audit('create', 'user:hr', null, d); setF({})
    } catch (x) { setErr(x.message) }
  }
  return <div className="card">
    <h3 style={{ marginTop: 0 }}>Logins</h3>
    <form onSubmit={add}>
      <F l="HR name" required value={f.name || ''} onChange={e => setF({ ...f, name: e.target.value })} />
      <F l="Email" type="email" required value={f.email || ''} onChange={e => setF({ ...f, email: e.target.value })} />
      <F l="Temporary password" minLength={6} required value={f.pw || ''} onChange={e => setF({ ...f, pw: e.target.value })} />
      <button>Create HR login</button>
    </form>
    {err && <div className="msg">{err}</div>}
    <Table
      head={['Name', 'Email', 'Role', 'Status', '']}
      rows={users.map(u => [
        u.name,
        u.email,
        u.role,
        <Tag s={u.active ? 'approved' : 'rejected'} />,
        u.role === 'admin' ? '' : (
          <span className="row">
            <button className="ghost" onClick={() => {
              updateDoc(doc(db, 'users', u.id), { active: !u.active })
              audit('update', 'user', { active: u.active }, { active: !u.active })
            }}>
              {u.active ? 'Deactivate' : 'Activate'}
            </button>
            <button className="ghost" onClick={() => sendPasswordResetEmail(auth, u.email)}>Reset password</button>
          </span>
        )
      ])}
    />
  </div>
}

export function Employees() {
  const { user } = useApp()
  const emps = useCol('employees')
  const depts = useCol('departments')
  const desigs = useCol('designations')
  const [f, setF] = useState({})
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [dep, setDep] = useState('')
  const today = ymd(new Date())

  const set = k => e => setF({ ...f, [k]: e.target.value })

  const add = async e => {
    e.preventDefault()
    setErr('')

    if (!f.code?.trim()) return setErr('Employee code is required.')
    if (!f.name?.trim()) return setErr('Name is required.')
    if (!f.email?.trim()) return setErr('Email is required.')
    if (!f.phone?.trim()) return setErr('Phone number is required.')
    if (!/^[0-9+\-\s]{10,15}$/.test(f.phone.trim())) {
      return setErr('Phone number must be 10–15 digits (only numbers, +, - allowed).')
    }
    if (!f.deptId) return setErr('Please select a department.')
    if (!f.designation) return setErr('Please select a designation.')
    if (!f.joinDate) return setErr('Joining date is required.')
    if (f.joinDate > today) return setErr('Joining date cannot be in the future.')
    if (!f.basic || +f.basic <= 0) return setErr('Basic salary must be greater than 0.')
    if (!f.pw || f.pw.length < 6) return setErr('Temporary password must be at least 6 characters.')

    if (emps.some(x => x.code === f.code || x.email === f.email)) {
      return setErr('Employee code and email must be unique.')
    }

    const d = depts.find(x => x.id === f.deptId)
    try {
      const uid = await createLogin(f.email, f.pw)
      await setDoc(doc(db, 'users', uid), {
        email: f.email,
        name: f.name,
        role: 'employee',
        active: true,
        mustChangePassword: true,
      })
      const emp = {
        code: f.code.trim(),
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: f.phone.trim(),
        address: '',
        deptId: d.id,
        deptName: d.name,
        designation: f.designation,
        joinDate: f.joinDate,
        basic: +f.basic,
        status: 'active',
      }
      await setDoc(doc(db, 'employees', uid), emp)
      audit('create', 'employee', null, emp)
      setF({})
    } catch (x) {
      setErr(x.message)
    }
  }

  const shown = emps.filter(x =>
    (!dep || x.deptId === dep) &&
    (x.name + x.code + x.email).toLowerCase().includes(q.toLowerCase())
  )

  return (
    <>
      <h1>Employees</h1>

      {user.role === 'hr' && (
        <form className="card" onSubmit={add}>
          <F l="Code" required value={f.code || ''} onChange={set('code')} />
          <F l="Name" required value={f.name || ''} onChange={set('name')} />
          <F l="Email" type="email" required value={f.email || ''} onChange={set('email')} />
          <F l="Phone" required value={f.phone || ''} onChange={set('phone')} placeholder="03XXXXXXXXX" />

          <label>
            Department
            <select required value={f.deptId || ''} onChange={set('deptId')}>
              <option value="">Select</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>

          <label>
            Designation
            <select required value={f.designation || ''} onChange={set('designation')}>
              <option value="">Select</option>
              {desigs.map(d => <option key={d.id}>{d.name}</option>)}
            </select>
          </label>

          <F
            l="Joining date"
            type="date"
            required
            max={today}
            value={f.joinDate || ''}
            onChange={set('joinDate')}
          />

          <F
            l="Basic salary"
            type="number"
            required
            min="1"
            value={f.basic || ''}
            onChange={set('basic')}
          />

          <F
            l="Temporary password"
            minLength={6}
            required
            value={f.pw || ''}
            onChange={set('pw')}
          />

          <button>Register employee</button>

          {err && <div className="msg" style={{ width: '100%' }}>{err}</div>}
          {(!depts.length || !desigs.length) && (
            <div className="msg" style={{ width: '100%' }}>
              Ask Admin to add departments and designations first.
            </div>
          )}
        </form>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <F l="Search" value={q} onChange={e => setQ(e.target.value)} />
        <label>
          Department
          <select value={dep} onChange={e => setDep(e.target.value)}>
            <option value="">All</option>
            {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
      </div>

      <Table
        head={['Code', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Joined', 'Basic']}
        empty="No employees yet. HR registers the first one."
        rows={shown.map(x => [
          x.code,
          x.name,
          x.email,
          x.phone || '—',
          x.deptName,
          x.designation,
          x.joinDate,
          x.basic,
        ])}
      />
    </>
  )
}