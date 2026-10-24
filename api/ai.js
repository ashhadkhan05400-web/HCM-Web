// Server-side AI proxy. The AI key never reaches the browser.
// Env: AI_API_KEY, AI_MODEL (optional), VITE_FB_API_KEY, VITE_FB_PROJECT_ID
// Uses the native Gemini generateContent endpoint so AQ. auth keys work.

const MODEL = process.env.AI_MODEL || 'gemini-3.8-flash'
const hits = new Map()

const POLICY = `COMPANY POLICY (answer policy questions ONLY from this; otherwise say you don't know):
- Office starts 09:00, grace 15 min: check-in after 09:15 is late. Under 5 hours worked = half day. Weekend is Sat-Sun.
- One attendance record per employee per day. Absent = no record and no approved leave. Missing checkout = no check-out.
- Leave counts working days only (weekends and holidays skipped). Yearly quotas: annual 14, sick 8, casual 10, unpaid unlimited. Overlapping or over-balance requests are rejected.
- Payroll: gross = 1.5 x basic. Per-day pay = gross / working days. Deductions: absent days + unpaid leave days + 0.5 per half day. Joiners/leavers are prorated. Tax is on gross x 12: 0 up to 600k; 5% to 1.2M; 30k + 15% to 2.4M; 210k + 25% to 3.6M; 510k + 35% above. Admin finalizes payroll and finalized months are locked.`

const T = (name, description, properties = {}, required = []) => ({
  name,
  description,
  parameters: {
    type: 'OBJECT',
    properties: Object.fromEntries(
      Object.entries(properties).map(([k, v]) => [k, { type: (v.type || 'string').toUpperCase(), description: v.description || '' }])
    ),
    ...(required.length ? { required } : {}),
  },
})

const range = {
  from: { type: 'string', description: 'YYYY-MM-DD, default start of this month' },
  to: { type: 'string', description: 'YYYY-MM-DD, default today' },
}

const STAFF = [
  T('get_headcount', 'Number of active employees, optionally for one department', { department: { type: 'string' } }),
  T('get_attendance_summary', 'Company attendance counts and attendance rate for a date range', range),
  T('get_late_comers', 'Top 5 employees by number of late arrivals in a date range', range),
  T('get_leave_summary', 'Approved leave days by type and pending request count for a date range', range),
  T('get_payroll_summary', 'Payroll totals for a month', { month: { type: 'string', description: 'YYYY-MM' } }),
  T('search_employees', 'Find employees by name, code or department', { query: { type: 'string' }, department: { type: 'string' } }),
]

const EMP = [
  T('get_my_leave_balance', "The signed-in employee's remaining leave days per type"),
  T('get_attendance_summary', "The signed-in employee's own attendance summary", range),
]

function toGeminiContents(messages) {
  const contents = []
  for (const m of messages || []) {
    if (m.role === 'system') continue
    if (m.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: String(m.content ?? '') }] })
    } else if (m.role === 'assistant') {
      const parts = []
      if (m.content) parts.push({ text: String(m.content) })
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let args = {}
          try { args = typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments || '{}') : (tc.function.arguments || {}) } catch { args = {} }
          parts.push({ functionCall: { name: tc.function.name, args } })
        }
      }
      if (parts.length) contents.push({ role: 'model', parts })
    } else if (m.role === 'tool') {
      let response = {}
      try { response = JSON.parse(m.content || '{}') } catch { response = { result: m.content } }
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name || 'tool', response } }],
      })
    }
  }
  return contents
}

async function llm({ system, messages, tools, jsonMode = false }) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 18000)
  try {
    const body = {
      contents: toGeminiContents(messages),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1024,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    }
    if (system) body.systemInstruction = { parts: [{ text: system }] }
    if (tools?.length) {
      body.tools = [{ functionDeclarations: tools }]
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${process.env.AI_API_KEY}`
    const r = await fetch(url, {
      method: 'POST',
      signal: ac.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const j = await r.json()
    if (!r.ok) {
      const msg = j.error?.message || j.error?.status || 'AI error'
      throw new Error(msg)
    }

    const cand = j.candidates?.[0]
    if (!cand) throw new Error('Empty AI response')

    const parts = cand.content?.parts || []
    const textParts = parts.filter(p => p.text).map(p => p.text).join('')
    const fnCalls = parts.filter(p => p.functionCall)

    if (fnCalls.length) {
      const tool_calls = fnCalls.map((fc, i) => ({
        id: `call_${Date.now()}_${i}`,
        type: 'function',
        function: {
          name: fc.functionCall.name,
          arguments: JSON.stringify(fc.functionCall.args || {}),
        },
      }))
      return { role: 'assistant', content: textParts || null, tool_calls }
    }
    return { role: 'assistant', content: textParts || '' }
  } finally {
    clearTimeout(t)
  }
}

const clean = ms => (ms || []).slice(-20).filter(m => ['user', 'assistant', 'tool'].includes(m.role))
  .map(m => ({
    role: m.role,
    content: String(m.content ?? ''),
    ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
    ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.name ? { name: m.name } : {}),
  }))

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (!process.env.AI_API_KEY) return res.status(503).json({ error: 'AI key is not set. Add AI_API_KEY to .env and restart the server.' })

  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '')
    if (!token) return res.status(401).json({ error: 'Please sign in again.' })

    const lk = await (await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.VITE_FB_API_KEY}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    })).json()
    const uid = lk.users?.[0]?.localId
    if (!uid) return res.status(401).json({ error: 'Please sign in again.' })

    const ud = await (await fetch(`https://firestore.googleapis.com/v1/projects/${process.env.VITE_FB_PROJECT_ID}/databases/(default)/documents/users/${uid}`, {
      headers: { Authorization: `Bearer ${token}` },
    })).json()
    const role = ud.fields?.role?.stringValue
    if (!role) return res.status(403).json({ error: 'No access.' })

    const now = Date.now()
    const list = (hits.get(uid) || []).filter(t => now - t < 36e5)
    if (list.length >= 20) return res.status(429).json({ error: 'Limit reached: 20 assistant requests per hour.' })
    hits.set(uid, [...list, now])

    const { mode, messages, kpis, text, types, today } = req.body || {}
    const staff = role !== 'employee'
    const dateLine = `Today is ${today} (${new Date(today + 'T00:00').toLocaleDateString('en-US', { weekday: 'long' })}).`

    if (mode === 'chat') {
      const system = `You are the HCM Lite assistant for a ${role}. ${dateLine} The database is the only source of truth: call a tool for any number or record, never guess. ` +
        `You may only use the tools given. Never reveal anyone's salary or personal data you cannot get from your tools; if asked, politely refuse. ` +
        `Understand English and Roman Urdu; reply in the language used. Keep answers short and helpful.\n\n${POLICY}`
      const m = await llm({
        system,
        messages: clean(messages),
        tools: staff ? STAFF : EMP,
      })
      if (m.tool_calls?.length) {
        return res.status(200).json({ type: 'tool_calls', message: m, tool_calls: m.tool_calls })
      }
      return res.status(200).json({ type: 'text', text: m.content || 'I have no answer for that.' })
    }

    if (mode === 'summary') {
      if (!staff) return res.status(403).json({ error: 'Not allowed.' })
      const m = await llm({
        system: 'Write 3 to 5 short bullet insights for an HR dashboard using ONLY the numbers in the JSON. Do not invent numbers. Start each bullet with "- ".',
        messages: [{ role: 'user', content: JSON.stringify(kpis) }],
      })
      return res.status(200).json({ type: 'text', text: m.content })
    }

    if (mode === 'leave') {
      if (staff) return res.status(403).json({ error: 'Not allowed.' })
      const ids = (types || []).map(t => t.id)
      const system = `${dateLine} Turn the request into JSON only: {"typeId": one of these ids ${JSON.stringify(ids)}, "start":"YYYY-MM-DD","end":"YYYY-MM-DD","reason":"short text"}. Resolve relative dates like "next Monday" from today. Use "casual" for personal/family events, "sick" for illness, "annual" for planned vacation.`
      for (let i = 0; i < 2; i++) {
        try {
          const m = await llm({
            system,
            messages: [{ role: 'user', content: String(text || '') }],
            jsonMode: true,
          })
          const d = JSON.parse(m.content || '{}')
          if (ids.includes(d.typeId) && /^\d{4}-\d{2}-\d{2}$/.test(d.start) && /^\d{4}-\d{2}-\d{2}$/.test(d.end) && d.start <= d.end) {
            return res.status(200).json({ type: 'leave', data: { typeId: d.typeId, start: d.start, end: d.end, reason: String(d.reason || '') } })
          }
        } catch (e) {
          if (e.name === 'AbortError') throw e
        }
      }
      return res.status(422).json({ error: 'Could not understand that request. Try writing dates clearly.' })
    }

    return res.status(400).json({ error: 'Bad mode.' })
  } catch (e) {
    console.error('AI handler error:', e.message)
    return res.status(502).json({
      error: e.name === 'AbortError'
        ? 'The assistant took too long. Please try again.'
        : (e.message?.includes('API key') || e.message?.includes('permission') || e.message?.includes('401')
          ? 'AI key problem. Check AI_API_KEY in .env'
          : 'The assistant is unavailable right now. Please try again.'),
    })
  }
}