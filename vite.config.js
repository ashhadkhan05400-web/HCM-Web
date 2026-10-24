import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// Runs api/ai.js locally so `npm run dev` works without extra tools (non-VITE_ vars stay server-side).
const aiDev = mode => ({
  name: 'ai-dev',
  configureServer(s) {
    Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
    s.middlewares.use('/api/ai', async (req, res) => {
      let b = ''; for await (const c of req) b += c
      req.body = b ? JSON.parse(b) : {}
      res.status = c => { res.statusCode = c; return res }
      res.json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)) }
      const { default: h } = await s.ssrLoadModule('/api/ai.js'); h(req, res)
    })
  },
})
export default defineConfig(({ mode }) => ({ plugins: [react(), aiDev(mode)] }))
