import { useState } from 'react'
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { useApp } from './ctx'
import { F, Table, Tag } from './ui'
import { callAI } from './ai'
import { attStatus, audit, isWork, notify, sortNew, useCol, wdays, ymd } from './lib'

export function Attendance() {
  const { user } = useApp()
  return (
    <>
      <h1>Attendance</h1>
      {user.role === 'employee' ? <Mine /> : <Board />}
    </>
  )
}

function Mine() {
  const { user, emp, settings } = useApp()
  const uid = user.uid
  const today = ymd(new Date())
  const id = `${uid}_${today}`

  const att = useCol('attendance', [where('empId', '==', uid)], uid)
  const fx = useCol('attendanceFixes', [where('empId', '==', uid)], uid)

  const [msg, setMsg] = useState('')
  const [f, setF] = useState({ date: today, inT: '09:00', outT: '17:00', reason: '' })

  const rec = att.find(a => a.date === today)

  const checkIn = async () => {
    setMsg('')
    if ((await getDoc(doc(db, 'attendance', id))).exists()) {
      return setMsg('Already checked in today.')
    }
    await setDoc(doc(db, 'attendance', id), {
      empId: uid,
      empName: user.name,
      deptId: emp?.deptId || '',
      date: today,
      checkIn: serverTimestamp(),
      rules: { start: settings.start, grace: settings.grace, half: settings.half }
    })
  }

  const checkOut = () => updateDoc(doc(db, 'attendance', id), { checkOut: serverTimestamp() })

  const ask = async e => {
    e.preventDefault()
    setMsg('')

    // Max 2 corrections per day
    const count = fx.filter(x => x.date === f.date).length
    if (count >= 2) {
      return setMsg('You can only send 2 correction requests per day.')
    }

    await addDoc(collection(db, 'attendanceFixes'), {
      ...f,
      empId: uid,
      empName: user.name,
      status: 'pending',
      at: serverTimestamp()
    })
    setMsg('Correction sent to HR.')
    setF({ date: today, inT: '09:00', outT: '17:00', reason: '' })
  }

  return (
    <>
      <div className="card row">
        <button onClick={checkIn} disabled={!!rec}>Check in</button>
        <button className="ghost" onClick={checkOut} disabled={!rec || !!rec.checkOut}>
          Check out
        </button>
        <span>
          {rec
            ? (rec.checkOut ? 'Done for today.' : 'Checked in. Time is stamped by the server.')
            : 'Not checked in yet.'}
        </span>
        {msg && <span className="msg">{msg}</span>}
      </div>

      <Table
        head={['Date', 'In', 'Out', 'Status']}
        empty="No attendance yet. Check in to start."
        rows={[...att]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map(a => [
            a.date,
            a.checkIn?.toDate().toLocaleTimeString() || '…',
            a.checkOut?.toDate().toLocaleTimeString() || '—',
            <Tag s={a.date === today && !a.checkOut ? 'in' : attStatus(a)} />
          ])}
      />

      <h3>Request a correction</h3>
      <form className="card" onSubmit={ask}>
        <F l="Date" type="date" max={today} required value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
        <F l="In" type="time" value={f.inT} onChange={e => setF({ ...f, inT: e.target.value })} />
        <F l="Out" type="time" value={f.outT} onChange={e => setF({ ...f, outT: e.target.value })} />
        <F l="Reason" required value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />
        <button>Send</button>
      </form>

      <Table
        head={['Date', 'Reason', 'Status', 'HR Comment']}
        empty="No corrections requested."
        rows={[...fx]
          .sort((a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0))
          .map(x => [
            x.date,
            x.reason,
            <Tag s={x.status} />,
            x.comment || '—'
          ])}
      />
    </>
  )
}

function Board() {
  const { user, settings } = useApp()
  const [date, setDate] = useState(ymd(new Date()))
  const [c, setC] = useState({})
  const emps = useCol('employees')
  const att = useCol('attendance')
  const lv = useCol('leaves')
  const fx = useCol('attendanceFixes')
  const hol = useCol('holidays').map(h => h.date)
  const today = ymd(new Date())

  const status = e => {
    const r = att.find(a => a.empId === e.id && a.date === date)
    if (r) return date === today && !r.checkOut ? 'in' : attStatus(r)
    if (lv.some(l => l.empId === e.id && l.status === 'approved' && l.start <= date && l.end >= date)) return 'on_leave'
    return date <= today && isWork(date, settings, hol) ? 'absent' : '—'
  }

  const decide = async (x, ok) => {
    if (ok) {
      await setDoc(doc(db, 'attendance', `${x.empId}_${x.date}`), {
        empId: x.empId,
        empName: x.empName,
        date: x.date,
        source: 'correction',
        checkIn: Timestamp.fromDate(new Date(`${x.date}T${x.inT}`)),
        checkOut: Timestamp.fromDate(new Date(`${x.date}T${x.outT}`)),
        rules: { start: settings.start, grace: settings.grace, half: settings.half }
      })
    }
    await updateDoc(doc(db, 'attendanceFixes', x.id), {
      status: ok ? 'approved' : 'rejected',
      comment: c[x.id] || '',
      decidedBy: user.name
    })
    audit(ok ? 'approve' : 'reject', 'attendanceFix', x, null)
    notify(x.empId, `Your correction for ${x.date} was ${ok ? 'approved' : 'rejected'}${!ok && c[x.id] ? ': ' + c[x.id] : ''}.`)
  }

  return (
    <>
      <div className="card">
        <F l="Day" type="date" value={date} onChange={e => setDate(e.target.value)} />
      </div>

      <Table
        head={['Employee', 'Department', 'Status']}
        empty="No employees registered yet."
        rows={emps.map(e => [e.name, e.deptName, <Tag s={status(e)} />])}
      />

      <h3>Corrections waiting</h3>
      <Table
        head={['Employee', 'Date', 'In–Out', 'Reason', '']}
        empty="Nothing waiting."
        rows={fx.filter(x => x.status === 'pending').map(x => [
          x.empName,
          x.date,
          `${x.inT}–${x.outT}`,
          x.reason,
          user.role === 'hr' ? (
            <span className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <input
                placeholder="Reason for rejection (required)"
                value={c[x.id] || ''}
                onChange={e => setC({ ...c, [x.id]: e.target.value })}
                style={{ minWidth: 160 }}
              />
              <button onClick={() => decide(x, true)}>Approve</button>
              <button
                className="bad"
                onClick={() => {
                  if (!c[x.id]?.trim()) {
                    alert('Please write a reason for rejection.')
                    return
                  }
                  decide(x, false)
                }}
              >
                Reject
              </button>
            </span>
          ) : 'HR decides'
        ])}
      />
    </>
  )
}

export function Leave() {
  const { user } = useApp()
  return (
    <>
      <h1>Leave</h1>
      {user.role === 'employee' ? <Mine2 /> : <Inbox />}
    </>
  )
}

function Mine2() {
  const { user, emp, settings } = useApp()
  const uid = user.uid
  const lv = useCol('leaves', [where('empId', '==', uid)], uid)
  const types = useCol('leaveTypes')
  const hol = useCol('holidays').map(h => h.date)

  const [f, setF] = useState({ typeId: '', start: '', end: '', reason: '' })
  const [err, setErr] = useState('')
  const [say, setSay] = useState('')
  const [aiBusy, setAiBusy] = useState(false)

  const days = f.start && f.end && f.start <= f.end ? wdays(f.start, f.end, settings, hol) : 0

  const fill = async () => {
    setErr('')
    setAiBusy(true)
    try {
      const r = await callAI({
        mode: 'leave',
        text: say,
        types: types.map(t => ({ id: t.id, name: t.name }))
      })
      setF({ ...f, ...r.data })
    } catch (x) {
      setErr(x.message + ' Fill the form below by hand.')
    }
    setAiBusy(false)
  }

 const apply = async e => {
  e.preventDefault()
  setErr('')

  const t = types.find(x => x.id === f.typeId)
  if (!t) return setErr('Please select leave type.')

  const today = ymd(new Date())
  const tomorrow = ymd(new Date(Date.now() + 86400000))

  // ===== DATE RULES =====
  if (t.name.toLowerCase().includes('sick')) {
    // Sick: today → 1 month
    const maxDate = ymd(new Date(Date.now() + 30 * 86400000))
    if (f.start < today) return setErr('Sick leave cannot start in the past.')
    if (f.end < f.start) return setErr('End date cannot be before start date.')
    if (f.start > maxDate || f.end > maxDate) return setErr('Sick leave can only be taken up to 1 month from today.')
  } else {
    // Other leaves: tomorrow → 2 weeks
    const maxDate = ymd(new Date(Date.now() + 14 * 86400000))
    if (f.start < tomorrow) return setErr('This leave can only start from tomorrow onwards.')
    if (f.end < f.start) return setErr('End date cannot be before start date.')
    if (f.start > maxDate || f.end > maxDate) return setErr('This leave can only be taken up to 2 weeks from today.')
  }
  // ======================

  const live = lv.filter(l => ['pending', 'approved'].includes(l.status))

  if (!days) return setErr('Pick working days only (weekends and holidays are skipped).')
  if (live.some(l => l.start <= f.end && l.end >= f.start)) return setErr('These dates overlap another leave.')

  const used = live
    .filter(l => l.typeId === t.id && l.start.slice(0, 4) === f.start.slice(0, 4))
    .reduce((s, l) => s + l.days, 0)

  if (t.quota != null && used + days > t.quota) {
    return setErr(`Over balance: ${t.quota - used} day(s) left.`)
  }

  const d = {
    ...f,
    typeName: t.name,
    days,
    empId: uid,
    empName: user.name,
    deptId: emp?.deptId || '',
    status: 'pending',
    at: serverTimestamp()
  }
  await addDoc(collection(db, 'leaves'), d)
  setF({ typeId: '', start: '', end: '', reason: '' })
}

  return (
    <>
      <div className="card row">
        <F
          l="Say it in plain words"
          style={{ minWidth: 320 }}
          placeholder="I need next Monday and Tuesday off for my sister's wedding"
          value={say}
          onChange={e => setSay(e.target.value)}
        />
        <button type="button" onClick={fill} disabled={!say || aiBusy}>
          {aiBusy ? 'Reading…' : 'Fill form with AI'}
        </button>
        <small style={{ opacity: 0.5 }}>AI-generated. Check the form, then press Apply.</small>
      </div>

      <form className="card" onSubmit={apply}>
        <label>
          Type
          <select required value={f.typeId} onChange={e => setF({ ...f, typeId: e.target.value })}>
            <option value="">Select</option>
            {types.map(t => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </label>
        <F l="From" type="date" required value={f.start} onChange={e => setF({ ...f, start: e.target.value })} />
        <F l="To" type="date" required value={f.end} onChange={e => setF({ ...f, end: e.target.value })} />
        <F l="Reason" required value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })} />
        <span>{days} working day(s)</span>
        <button>Apply</button>
        {err && <div className="msg" style={{ width: '100%' }}>{err}</div>}
      </form>

      <Table
        head={['Type', 'From', 'To', 'Days', 'Status', 'HR Comment', '']}
        empty="No leave requests yet."
        rows={[...lv].sort(sortNew).map(l => [
          l.typeName,
          l.start,
          l.end,
          l.days,
          <Tag s={l.status} />,
          l.comment || '—',
          l.status === 'pending' ? (
            <button
              className="ghost"
              onClick={() => updateDoc(doc(db, 'leaves', l.id), { status: 'cancelled' })}
            >
              Cancel
            </button>
          ) : ''
        ])}
      />
    </>
  )
}

function Inbox() {
  const { user } = useApp()
  const lv = useCol('leaves')
  const [c, setC] = useState({})

  const decide = async (l, ok) => {
    const u = {
      status: ok ? 'approved' : 'rejected',
      comment: c[l.id] || '',
      decidedBy: user.name
    }
    await updateDoc(doc(db, 'leaves', l.id), u)
    audit(ok ? 'approve' : 'reject', 'leave', l, u)
    notify(l.empId, `Your ${l.typeName} leave (${l.start} to ${l.end}) was ${u.status}.`)
  }

  const rows = (arr, act) =>
    arr.map(l => [
      l.empName,
      l.typeName,
      `${l.start} → ${l.end}`,
      l.days,
      l.reason,
      act ? (
        <span className="row">
          <input
            placeholder="Comment"
            onChange={e => setC({ ...c, [l.id]: e.target.value })}
          />
          {user.role === 'hr' ? (
            <>
              <button onClick={() => decide(l, true)}>Approve</button>
              <button className="bad" onClick={() => decide(l, false)}>Reject</button>
            </>
          ) : (
            'HR decides'
          )}
        </span>
      ) : (
        <Tag s={l.status} />
      )
    ])

  return (
    <>
      <h3>Waiting for a decision</h3>
      <Table
        head={['Employee', 'Type', 'Dates', 'Days', 'Reason', '']}
        rows={rows(lv.filter(l => l.status === 'pending'), true)}
        empty="No pending requests."
      />
      <h3>History</h3>
      <Table
        head={['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status']}
        rows={rows([...lv].filter(l => l.status !== 'pending').sort(sortNew))}
        empty="No decisions yet."
      />
    </>
  )
}