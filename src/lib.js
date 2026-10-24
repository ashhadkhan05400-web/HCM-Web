import { useEffect, useState, useSyncExternalStore } from 'react'
import { addDoc, collection, onSnapshot, query, serverTimestamp } from 'firebase/firestore'
import { jsPDF } from 'jspdf'
import { auth, db } from './firebase'

export const ymd = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
export function* eachDay(a, b) { for (const d = new Date(a + 'T00:00'); ymd(d) <= b; d.setDate(d.getDate() + 1)) yield ymd(d) }
export const isWork = (d, s, hol) => !s.weekend.includes(new Date(d + 'T00:00').getDay()) && !hol.includes(d)
export const wdays = (a, b, s, hol) => { let n = 0; for (const d of eachDay(a, b)) if (isWork(d, s, hol)) n++; return n }
export const sortNew = (a, b) => (b.at?.seconds || 0) - (a.at?.seconds || 0)

let pending = 0; const subs = new Set()
const bump = n => { pending += n; subs.forEach(f => f()) }
export const usePending = () => useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => pending)
export function useCol(path, cons = [], key = '') {
  const [d, setD] = useState([])
  useEffect(() => {
    let done = false; const fin = () => { if (!done) { done = true; bump(-1) } }
    bump(1)
    const un = onSnapshot(cons.length ? query(collection(db, path), ...cons) : collection(db, path),
      s => { setD(s.docs.map(x => ({ id: x.id, ...x.data() }))); fin() }, e => { console.error(path, e.message); fin() })
    return () => { un(); fin() }
  }, [path, key])
  return d
}

export const audit = (action, entity, before = null, after = null) => addDoc(collection(db, 'auditLogs'), {
  actor: auth.currentUser.uid, actorEmail: auth.currentUser.email, action, entity,
  before: JSON.stringify(before), after: JSON.stringify(after), at: serverTimestamp() })
export const notify = (toUid, text) => addDoc(collection(db, 'notifications'), { toUid, text, read: false, at: serverTimestamp() })

// Status is derived from the rules stored on the record when it was created.
export function attStatus(r) {
  if (!r?.checkIn) return 'absent'
  const ci = r.checkIn.toDate(), [h, m] = r.rules.start.split(':')
  const lateAt = new Date(ci); lateAt.setHours(+h, +m + +r.rules.grace, 0, 0)
  if (!r.checkOut) return 'missing_checkout'
  if ((r.checkOut.toDate() - ci) / 36e5 < r.rules.half) return 'half_day'
  return ci > lateAt ? 'late' : 'present'
}

export function tax(gross) {
  const a = gross * 12; let t = 0
  if (a > 3.6e6) t = 510000 + (a - 3.6e6) * .35
  else if (a > 2.4e6) t = 210000 + (a - 2.4e6) * .25
  else if (a > 1.2e6) t = 30000 + (a - 1.2e6) * .15
  else if (a > 6e5) t = (a - 6e5) * .05
  return Math.round(t / 12)
}

export function payroll(e, month, s, hol, att, leaves, today) {
  const [y, m] = month.split('-').map(Number), first = `${month}-01`, last = ymd(new Date(y, m, 0))
  const from = e.joinDate > first ? e.joinDate : first, to = e.exitDate && e.exitDate < last ? e.exitDate : last
  const total = wdays(first, last, s, hol), mine = wdays(from, to, s, hol)
  const gross = 1.5 * e.basic, per = gross / total
  const have = new Set(att.map(a => a.date)), leave = new Set(); let unpaid = 0, absent = 0, half = 0
  leaves.forEach(l => { for (const d of eachDay(l.start > from ? l.start : from, l.end < to ? l.end : to)) if (isWork(d, s, hol)) { leave.add(d); if (l.typeId === 'unpaid') unpaid++ } })
  const upto = to < today ? to : today
  for (const d of eachDay(from, upto > from ? upto : from)) if (d <= upto && isWork(d, s, hol) && !have.has(d) && !leave.has(d)) absent++
  att.forEach(a => { if (a.date >= from && a.date <= to && attStatus(a) === 'half_day') half++ })
  const earned = per * mine, deduction = per * (absent + unpaid + .5 * half), t = tax(gross)
  const r = Math.round
  return { month, gross: r(gross), workDays: total, paidDays: mine, absent, unpaid, half, deduction: r(deduction), tax: t, net: r(earned - deduction - t) }
}

export function slipPdf(p, company) {
  const d = new jsPDF(); d.setFontSize(16); d.text(`${company} - Payslip ${p.month}`, 14, 20); d.setFontSize(11)
  ;[['Employee', p.name], ['Department', p.dept], ['Gross salary', p.gross], ['Working days', p.workDays], ['Absent days', p.absent],
    ['Unpaid leave days', p.unpaid], ['Half days', p.half], ['Deductions', p.deduction], ['Tax', p.tax], ['Net pay', p.net]]
    .forEach(([k, v], i) => { d.text(k, 14, 36 + i * 8); d.text(String(v ?? ''), 100, 36 + i * 8) })
  d.save(`payslip-${p.month}.pdf`)
}
export function isLate(r) {
  if (!r?.checkIn) return false
  const [h, m] = r.rules.start.split(':'), lateAt = new Date(r.checkIn.toDate()); lateAt.setHours(+h, +m + +r.rules.grace, 0, 0)
  return r.checkIn.toDate() > lateAt
}
export const hours = r => r?.checkIn && r?.checkOut ? (r.checkOut.toDate() - r.checkIn.toDate()) / 36e5 : 0
