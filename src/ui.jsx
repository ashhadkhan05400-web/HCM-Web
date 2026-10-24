import { useState } from 'react'
import { addDoc, collection, deleteDoc, doc } from 'firebase/firestore'
import { db } from './firebase'
import { audit, useCol, usePending } from './lib'
export const F = ({ l, ...p }) => <label>{l}<input {...p} /></label>
export const Tag = ({ s }) => <span className={`tag ${s}`}>{String(s).replace('_', ' ')}</span>
export const Empty = ({ t }) => <p style={{ opacity: .6 }}>{t}</p>
export const Table = ({ head, rows, empty = 'Nothing here yet.' }) => {
  const p = usePending()
  if (!rows.length && p > 0) return <div className="wrap" style={{ padding: 12 }}>{[0, 1, 2, 3].map(i => <div key={i} className="sk" style={{ height: 34, margin: '8px 0' }} />)}</div>
  return rows.length
    ? <div className="wrap"><table><thead><tr>{head.map(h => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
    : <Empty t={empty} />
}

// Simple "list + add" block used for departments, designations, holidays, leave types.
export function ListAdd({ col, title, fields, show }) {
  const items = useCol(col), [f, setF] = useState({})
  const add = async e => {
    e.preventDefault()
    const d = Object.fromEntries(fields.map(x => [x.k, x.type === 'number' ? (f[x.k] === '' || f[x.k] == null ? null : +f[x.k]) : (f[x.k] || '')]))
    await addDoc(collection(db, col), d); audit('create', col, null, d); setF({})
  }
  return <div className="card"><h3 style={{ marginTop: 0 }}>{title}</h3>
    <form onSubmit={add}>{fields.map(x => <F key={x.k} l={x.l} type={x.type || 'text'} required={!x.optional} value={f[x.k] ?? ''} onChange={e => setF({ ...f, [x.k]: e.target.value })} />)}<button>Add</button></form>
    <Table head={['Name', '']} rows={items.map(i => [show(i), <button className="ghost" onClick={() => { deleteDoc(doc(db, col, i.id)); audit('delete', col, i, null) }}>Remove</button>])} empty={`No ${title.toLowerCase()} yet. Add the first one above.`} /></div>
}
