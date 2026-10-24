import { useEffect, useState } from 'react'
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { useApp } from './ctx'
import { F, Table } from './ui'
import { callAI } from './ai'
import { audit, hours, isLate, notify, sortNew, useCol, usePending, ymd } from './lib'

const Kpi = ({ n, t }) => {
  const p = usePending()
  return (
    <div className="kpi">
      {p > 0 && !n ? <div className="sk" style={{ height: 30, width: 56, marginBottom: 4 }} /> : <b>{n}</b>}
      {t}
    </div>
  )
}

export function Dashboard() {
  const { user } = useApp()
  return (
    <>
      <div className="head">
        <h1>Heyy {user.name.split(' ')[0]}</h1>
        <span>{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </div>
      {user.role === 'employee' ? <Mine /> : <Staff />}
      <News limit={3} />
    </>
  )
}

function Staff() {
  const today = ymd(new Date())
  const emps = useCol('employees')
  const att = useCol('attendance')
  const lv = useCol('leaves')
  const fx = useCol('attendanceFixes')

  const active = emps.filter(e => e.status !== 'exited')
  const todays = att.filter(a => a.date === today)
  const onLeave = lv.filter(l => l.status === 'approved' && l.start <= today && l.end >= today)

  const byDept = {}
  active.forEach(e => {
    byDept[e.deptName] = (byDept[e.deptName] || 0) + 1
  })

  const [sum, setSum] = useState('')
  const [busy, setBusy] = useState(false)

  const summarize = async () => {
    setBusy(true)
    setSum('')
    const kpis = {
      headcount: active.length,
      checked_in_today: todays.length,
      on_leave_today: onLeave.length,
      late_today: todays.filter(isLate).length,
      leave_awaiting_approval: lv.filter(l => l.status === 'pending').length,
      corrections_awaiting_approval: fx.filter(f => f.status === 'pending').length,
      headcount_by_department: byDept
    }
    try {
      setSum((await callAI({ mode: 'summary', kpis })).text)
    } catch (x) {
      setSum(x.message)
    }
    setBusy(false)
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <button onClick={summarize} disabled={busy}>
          {busy ? 'Summarizing…' : 'Summarize with AI'}
        </button>
      </div>

      {sum && (
        <div className="card">
          <p style={{ whiteSpace: 'pre-line', margin: 0 }}>{sum}</p>
          <small style={{ opacity: 0.5 }}>AI-generated</small>
        </div>
      )}

      <div className="kpis">
        <Kpi n={active.length} t="Headcount" />
        <Kpi n={todays.length} t="Checked in today" />
        <Kpi n={onLeave.length} t="On leave today" />
        <Kpi n={todays.filter(isLate).length} t="Late today" />
        <Kpi n={lv.filter(l => l.status === 'pending').length} t="Leave awaiting approval" />
        <Kpi n={fx.filter(f => f.status === 'pending').length} t="Corrections awaiting approval" />
      </div>

      <h3>Headcount by department</h3>
      <Table
        head={['Department', 'People']}
        rows={Object.entries(byDept)}
        empty="No employees registered yet."
      />
    </>
  )
}

function Mine() {
  const { user } = useApp()
  const uid = user.uid
  const today = new Date()

  const att = useCol('attendance', [where('empId', '==', uid)], uid)
  const lv = useCol('leaves', [where('empId', '==', uid)], uid)
  const types = useCol('leaveTypes')
  const slips = useCol('payslips', [where('empId', '==', uid)], uid)
  const notes = useCol('notifications', [where('toUid', '==', uid)], uid)

  const unreadCount = notes.filter(n => n.read !== true).length

  // 2.5 second baad mark as read (taake badge dikhe)
  useEffect(() => {
    if (!notes.length) return
    const timer = setTimeout(() => {
      notes
        .filter(n => n.read !== true)
        .forEach(n => {
          updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {})
        })
    }, 2500)
    return () => clearTimeout(timer)
  }, [notes])

  const mon = new Date(today)
  mon.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const ms = ymd(mon)
  const month = ymd(today).slice(0, 7)
  const year = String(today.getFullYear())

  const last = [...slips].sort((a, b) => b.month.localeCompare(a.month))[0]

  return (
    <>
      <div className="kpis">
        <Kpi
          n={att.filter(a => a.date >= ms).reduce((s, a) => s + hours(a), 0).toFixed(1) + ' / 40'}
          t="Hours this week"
        />
        <Kpi
          n={att.filter(a => a.date.startsWith(month) && isLate(a)).length}
          t="Late this month"
        />
        <Kpi
          n={last ? last.net : '—'}
          t={last ? `Last payslip (${last.month})` : 'No payslip yet'}
        />
      </div>

      <h3>Leave left this year</h3>
      <Table
        head={['Type', 'Left']}
        rows={types.map(t => {
          const used = lv
            .filter(l => l.typeId === t.id && ['approved', 'pending'].includes(l.status) && l.start.startsWith(year))
            .reduce((s, l) => s + l.days, 0)
          return [t.name, t.quota == null ? 'Unlimited' : t.quota - used]
        })}
      />

      <h3>
        Notifications{' '}
        {unreadCount > 0 && (
          <span style={{
            background: '#e74c3c',
            color: '#fff',
            fontSize: 12,
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 99,
            marginLeft: 6
          }}>
            {unreadCount} new
          </span>
        )}
      </h3>

      <Table
        head={['Message']}
        rows={[...notes].sort(sortNew).slice(0, 10).map(n => [n.text])}
        empty="No notifications."
      />
    </>
  )
}

function News({ limit }) {
  const items = [...useCol('announcements')].sort(sortNew).slice(0, limit)
  return (
    <>
      <h3>Announcements</h3>
      {items.length ? (
        items.map(a => (
          <div className="card" key={a.id}>
            <b>{a.title}</b>
            <p style={{ margin: '4px 0 0' }}>{a.body}</p>
          </div>
        ))
      ) : (
        <p style={{ opacity: 0.6 }}>No announcements.</p>
      )}
    </>
  )
}

export function Announcements() {
  const { user } = useApp()
  const [f, setF] = useState({ title: '', body: '' })

  const post = async e => {
    e.preventDefault()

    await addDoc(collection(db, 'announcements'), {
      ...f,
      by: user.name,
      at: serverTimestamp()
    })
    audit('create', 'announcement', null, f)

    try {
      const snap = await getDocs(collection(db, 'employees'))
      for (const emp of snap.docs) {
        if (emp.data().status !== 'exited') {
          notify(emp.id, `New announcement: ${f.title}`)
        }
      }
    } catch (err) {
      console.error('Failed to send notifications', err)
    }

    setF({ title: '', body: '' })
  }

  return (
    <>
      <h1>Announcements</h1>

      {user.role !== 'employee' && (
        <form className="card" onSubmit={post}>
          <F
            l="Title"
            required
            value={f.title}
            onChange={e => setF({ ...f, title: e.target.value })}
          />
          <F
            l="Message"
            required
            value={f.body}
            onChange={e => setF({ ...f, body: e.target.value })}
            style={{ minWidth: 320 }}
          />
          <button>Post</button>
        </form>
      )}

      <News limit={50} />
    </>
  )
}

export function Audit() {
  const logs = [...useCol('auditLogs')].sort(sortNew).slice(0, 200)
  return (
    <>
      <h1>Audit log</h1>
      <Table
        head={['When', 'Who', 'Action', 'Entity', 'After']}
        empty="No actions logged yet."
        rows={logs.map(l => [
          l.at ? new Date(l.at.seconds * 1000).toLocaleString() : '…',
          l.actorEmail,
          l.action,
          l.entity,
          <small>{(l.after || '').slice(0, 80)}</small>
        ])}
      />
    </>
  )
}