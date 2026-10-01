import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function localAssistant(mode: string): Plugin {
  return { name:'local-assistant-api', apply:'serve', configureServer(server) {
    const env = loadEnv(mode, process.cwd(), '')
    // Assign only in the server process; Vite exposes only VITE_PUBLIC_ values.
    for (const name of ['TRACE_AI_PROVIDER','FIREWORKS_API_KEY','FIREWORKS_MODEL','GEMINI_API_KEY','GEMINI_MODEL']) {
      if (!process.env[name] && env[name]) process.env[name] = env[name]
    }
    process.env.SUPABASE_URL ||= env.VITE_PUBLIC_SUPABASE_URL
    process.env.SUPABASE_PUBLISHABLE_KEY ||= env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    server.middlewares.use('/api/assistant', async (req,res) => {
      if (req.method !== 'POST') { res.statusCode=405; res.end('Method not allowed'); return }
      try {
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of req) {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += bytes.length
          if (size > 3500) { res.statusCode=413; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:'Request too large.'})); return }
          chunks.push(bytes)
        }
        const headers = new Headers()
        for (const [key,value] of Object.entries(req.headers)) if (value) headers.set(key,Array.isArray(value) ? value.join(',') : value)
        const request = new Request('http://localhost/api/assistant',{ method:'POST',headers,body:Buffer.concat(chunks) })
        const { POST } = await import('./api/assistant.js')
        const reply = await POST(request)
        res.statusCode=reply.status
        reply.headers.forEach((value,key)=>res.setHeader(key,value))
        res.end(Buffer.from(await reply.arrayBuffer()))
      } catch {
        res.statusCode=503; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({error:'Assistant server could not complete the request.'}))
      }
    })
  } }
}

export default defineConfig(({mode}) => ({
  plugins: [react(),localAssistant(mode)],
  // Only explicitly public variables may be imported into browser code.
  envPrefix: 'VITE_PUBLIC_',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}))
