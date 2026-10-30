import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
    name: 'anonymous-game-service',
    async configureServer(server) {
      if (process.env.VITEST) return
      const { createGameService } = await import('./server/service.ts')
      const game = createGameService()
      server.middlewares.use((req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://game.local').pathname
        let decoded: string
        try { decoded = decodeURIComponent(pathname).replaceAll('\\', '/') }
        catch { res.statusCode = 400; res.end(); return }
        if (/(?:^|\/)(?:server|local-config|materials|archive|\.git)(?:\/|$)|\/src\/test(?:\/|$)/u.test(decoded)) {
          res.statusCode = 404
          res.end('Not found')
          return
        }
        if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/healthz') void game.handle(req, res)
        else next()
      })
    },
  }],
  server: { fs: { deny: process.env.VITEST ? ['**/.env*', '**/.git/**']
    : ['**/server/**', '**/src/test/**', '**/local-config/**', '**/materials/**', '**/archive/**', '**/.env*', '**/.git/**'] } },
  test: {
    environment: 'happy-dom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
