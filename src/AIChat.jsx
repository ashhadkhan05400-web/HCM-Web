import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, Trash2, X } from 'lucide-react'
import { useApp } from './ctx'
import { chat } from './ai'

const CHIPS = {
  staff: [
    'Who is on leave today?',
    'Who came late most often this month?',
    "What is this month's attendance rate?",
    'How many employees are active?',
  ],
  employee: [
    'How many sick leaves do I have left?',
    'Mujhe kitni casual leaves bachi hain?',
    'What counts as a late check-in?',
    'How is my attendance this month?',
  ],
}

export default function AIChat() {
  const ctx = useApp()
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const hist = useRef([])
  const end = useRef(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [log, busy, open])

  const send = async q => {
    q = (q || '').trim()
    if (!q || busy) return
    setInput('')
    setBusy(true)
    setLog(l => [...l, { r: 'u', t: q }])
    try {
      const a = await chat([...hist.current, { role: 'user', content: q }], ctx)
      hist.current = [...hist.current, { role: 'user', content: q }, { role: 'assistant', content: a }].slice(-12)
      setLog(l => [...l, { r: 'a', t: a }])
    } catch (x) {
      setLog(l => [...l, { r: 'e', t: x.message || 'Something went wrong.' }])
    }
    setBusy(false)
  }

  if (!open) {
    return (
      <button className="aibtn" onClick={() => setOpen(true)}>
        <Sparkles size={18} />Ask AI
      </button>
    )
  }

  const roleKey = ctx.user?.role === 'employee' ? 'employee' : 'staff'

  return (
    <div className="aipanel" role="dialog" aria-label="AI assistant">
      <div className="aihead">
        <Sparkles size={18} color="#f2a33a" />
        <b>AI assistant</b>
        <button title="Clear chat" aria-label="Clear chat" onClick={() => { setLog([]); hist.current = [] }}>
          <Trash2 size={17} />
        </button>
        <button title="Close" aria-label="Close" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>
      <div className="aibody">
        {!log.length && (
          <>
            <div className="bub a">
              Hi {ctx.user?.name?.split(' ')[0] || 'there'}! Ask me about{' '}
              {ctx.user?.role === 'employee'
                ? 'your leave, attendance or company policy'
                : 'attendance, leave, headcount or payroll'}.
              English and Roman Urdu both work.
            </div>
            <div className="chips">
              {CHIPS[roleKey].map(c => (
                <button key={c} onClick={() => send(c)}>{c}</button>
              ))}
            </div>
          </>
        )}
        {log.map((m, i) => (
          <div key={i} style={{ display: 'contents' }}>
            <div className={`bub ${m.r}`}>{m.t}</div>
            {m.r === 'a' && <div className="lbl">AI-generated</div>}
          </div>
        ))}
        {busy && (
          <div className="bub a dots">
            <span /><span /><span />
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="aiform" onSubmit={e => { e.preventDefault(); send(input) }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask a question"
          aria-label="Message"
          disabled={busy}
        />
        <button disabled={busy || !input.trim()} aria-label="Send">
          <Send size={17} />
        </button>
      </form>
    </div>
  )
}