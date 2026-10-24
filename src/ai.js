import { addDoc, collection, getDocs, getDoc, doc, query, serverTimestamp, where } from 'firebase/firestore'
import { auth, db } from './firebase'
import { attStatus, eachDay, isLate, isWork, ymd } from './lib'

export async function callAI(body) {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000)
  try {
    const user = auth.currentUser
    if (!user) throw new Error('Please sign in again.')
    const tk = await user.getIdToken()
    const r = await fetch('/api/ai', {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + tk },
      body: JSON.stringify({ ...body, today: ymd(new Date()) }),
    })
    const j = await r.json().catch(() => ({}))
   if (!r.ok) {
  console.error('AI API response:', j)
  throw new Error(j.error || JSON.stringify(j) || 'The assistant is unavailable right now. Please try again.')
}
    addDoc(collection(db, 'aiLogs'), { uid: user.uid, mode: body.mode, at: serverTimestamp() }).catch(() => {})
    return j
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'The assistant took too long. Please try again.' : e.message)
  } finally {
    clearTimeout(t)
  }
}

const rows = async (c, cons = []) => {
  const snap = await getDocs(cons.length ? query(collection(db, c), ...cons) : collection(db, c))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}
const rng = a => {
  const t = new Date()
  return [a.from || ymd(new Date(t.getFullYear(), t.getMonth(), 1)), a.to || ymd(t)]
}

const TOOLS = {
  async get_headcount(a) {
    const e = (await rows('employees')).filter(x => x.status !== 'exited' && (!a.department || (x.deptName || '').toLowerCase() === a.department.toLowerCase()))
    return { department: a.department || 'all', active_employees: e.length }
  },
  async get_attendance_summary(a, { user, settings }) {
    const [f, t] = rng(a)
    const staff = user.role !== 'employee'
    const own = staff ? [] : [where('empId', '==', user.uid)]
    const [att, lv, hol, emps] = await Promise.all([
      rows('attendance', own),
      rows('leaves', own),
      rows('holidays'),
      staff ? rows('employees') : [],
    ])
    const h = hol.map(x => x.date)
    const today = ymd(new Date())
    const upto = t < today ? t : today
    const ids = staff ? emps.filter(e => e.status !== 'exited').map(e => e.id) : [user.uid]
    const c = { present: 0, late: 0, half_day: 0, missing_checkout: 0 }
    att.filter(r => r.date >= f && r.date <= t).forEach(r => { c[attStatus(r)] = (c[attStatus(r)] || 0) + 1 })
    let expected = 0
    ids.forEach(id => {
      for (const d of eachDay(f, upto)) {
        if (isWork(d, settings, h) && !lv.some(l => l.empId === id && l.status === 'approved' && l.start <= d && l.end >= d)) expected++
      }
    })
    const seen = c.present + c.late + c.half_day + c.missing_checkout
    return {
      from: f, to: t, ...c,
      expected_days: expected,
      absent_days: Math.max(0, expected - seen),
      attendance_rate_pct: expected ? +(((c.present + c.late + c.missing_checkout + 0.5 * c.half_day) / expected) * 100).toFixed(1) : null,
    }
  },
  async get_late_comers(a) {
    const [f, t] = rng(a)
    const n = {}
    ;(await rows('attendance')).filter(r => r.date >= f && r.date <= t && isLate(r)).forEach(r => {
      n[r.empName] = (n[r.empName] || 0) + 1
    })
    return {
      from: f, to: t,
      top5: Object.entries(n).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([name, late_days]) => ({ name, late_days })),
    }
  },
  async get_leave_summary(a) {
    const [f, t] = rng(a)
    const l = await rows('leaves')
    const by = {}
    l.filter(x => x.status === 'approved' && x.start <= t && x.end >= f).forEach(x => {
      by[x.typeName] = (by[x.typeName] || 0) + x.days
    })
    return { from: f, to: t, approved_days_by_type: by, pending_requests: l.filter(x => x.status === 'pending').length }
  },
  async get_my_leave_balance(a, { user }) {
    const [types, lv] = await Promise.all([
      rows('leaveTypes'),
      rows('leaves', [where('empId', '==', user.uid)]),
    ])
    const y = String(new Date().getFullYear())
    return types.map(t => ({
      type: t.name,
      left: t.quota == null
        ? 'unlimited'
        : t.quota - lv.filter(l => l.typeId === t.id && ['approved', 'pending'].includes(l.status) && l.start.startsWith(y)).reduce((s, l) => s + l.days, 0),
    }))
  },
  async get_payroll_summary(a) {
    const m = a.month || ymd(new Date()).slice(0, 7)
    const s = await getDoc(doc(db, 'payrollRuns', m))
    if (!s.exists()) return { month: m, status: 'no payroll run yet' }
    const i = s.data().items || []
    const sum = k => i.reduce((x, p) => x + (p[k] || 0), 0)
    return { month: m, status: s.data().status, employees: i.length, total_gross: sum('gross'), total_tax: sum('tax'), total_net: sum('net') }
  },
  async search_employees(a) {
    const q = (a.query || '').toLowerCase()
    const d = (a.department || '').toLowerCase()
    return (await rows('employees'))
      .filter(e => (!d || (e.deptName || '').toLowerCase() === d) && (e.name + e.code + (e.designation || '')).toLowerCase().includes(q))
      .slice(0, 10)
      .map(e => ({ name: e.name, code: e.code, department: e.deptName, designation: e.designation, joined: e.joinDate }))
  },
}

const EMP_OK = ['get_my_leave_balance', 'get_attendance_summary']

export async function chat(history, ctx) {
  const m = [...history]
  for (let i = 0; i < 5; i++) {
    const r = await callAI({ mode: 'chat', messages: m })
    if (r.type === 'text') return r.text || 'I have no answer for that.'
    if (!r.tool_calls?.length) return r.text || 'I have no answer for that.'

    m.push(r.message)
    for (const tc of r.tool_calls) {
      const n = tc.function.name
      let out
      try {
        if (!TOOLS[n] || (ctx.user.role === 'employee' && !EMP_OK.includes(n))) {
          out = { error: 'Not allowed for your role.' }
        } else {
          out = await TOOLS[n](JSON.parse(tc.function.arguments || '{}'), ctx)
        }
      } catch (e) {
        out = { error: e.message }
      }
      m.push({ role: 'tool', tool_call_id: tc.id, name: n, content: JSON.stringify(out) })
    }
  }
  return 'Sorry, I could not finish that. Try a simpler question.'
}