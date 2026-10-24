import { useState } from 'react'
import { doc, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { db } from './firebase'
import { useApp } from './ctx'
import { F, Table, Tag } from './ui'
import { audit, notify, payroll, slipPdf, useCol, ymd } from './lib'

export function Payroll() {
  const { user, settings } = useApp(), [month, setMonth] = useState(ymd(new Date()).slice(0, 7)), [draft, setDraft] = useState(null)
  const emps = useCol('employees'), hol = useCol('holidays').map(h => h.date), att = useCol('attendance'), lv = useCol('leaves'), runs = useCol('payrollRuns')
  const run = runs.find(r => r.id === month), items = run?.items || draft
  const gen = () => setDraft(emps.filter(e => e.status !== 'exited').map(e => ({ ...payroll(e, month, settings, hol, att.filter(a => a.empId === e.id), lv.filter(l => l.empId === e.id && l.status === 'approved'), ymd(new Date())), empId: e.id, name: e.name, dept: e.deptName })))
  const save = async () => { await setDoc(doc(db, 'payrollRuns', month), { month, status: 'draft', items, by: user.name, at: serverTimestamp() }); audit('save', 'payrollDraft', null, { month }); setDraft(null) }
  const finalize = async () => {
    if (!confirm(`Finalize ${month}? This locks the month.`)) return
    await updateDoc(doc(db, 'payrollRuns', month), { status: 'finalized', finalizedBy: user.name })
    for (const p of run.items) { await setDoc(doc(db, 'payslips', `${month}_${p.empId}`), { ...p, month, at: serverTimestamp() }); notify(p.empId, `Your payslip for ${month} is ready.`) }
    audit('finalize', 'payroll', { status: 'draft' }, { month, status: 'finalized' })
  }
  return <><h1>Payroll</h1><div className="card row"><F l="Month" type="month" value={month} onChange={e => { setMonth(e.target.value); setDraft(null) }} />
    {user.role === 'hr' && !run && <button onClick={gen}>Generate draft</button>}
    {user.role === 'hr' && draft && !run && <button onClick={save}>Save draft</button>}
    {user.role === 'admin' && run?.status === 'draft' && <button onClick={finalize}>Finalize month</button>}
    {run && <Tag s={run.status === 'finalized' ? 'approved' : 'pending'} />}</div>
    <Table head={['Employee', 'Dept', 'Gross', 'Absent', 'Unpaid', 'Half', 'Deductions', 'Tax', 'Net']} empty="Generate a draft to see this month's payroll." rows={(items || []).map(p => [p.name, p.dept, p.gross, p.absent, p.unpaid, p.half, p.deduction, p.tax, <b>{p.net}</b>])} /></>
}

export function Payslips() {
  const { user, settings } = useApp(), staff = user.role !== 'employee'
  const slips = useCol('payslips', staff ? [] : [where('empId', '==', user.uid)], user.uid + staff)
  return <><h1>Payslips</h1><Table head={['Month', ...(staff ? ['Employee'] : []), 'Net pay', '']} empty="No payslips yet. They appear when Admin finalizes a month."
    rows={[...slips].sort((a, b) => b.month.localeCompare(a.month)).map(p => [p.month, ...(staff ? [p.name] : []), p.net, <button className="ghost" onClick={() => slipPdf(p, settings.name)}>Download PDF</button>])} /></>
}
