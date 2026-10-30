import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGameService } from './service'

const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, directory: string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }); res.end(); return
  }
  let pathname: string
  try { pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://game.local').pathname) }
  catch { res.writeHead(400); res.end(); return }
  if (pathname.includes('\0') || pathname.includes('\\')) { res.writeHead(400); res.end(); return }
  let file = resolve(directory, `.${pathname}`)
  if (file !== directory && !file.startsWith(`${directory}${sep}`)) { res.writeHead(403); res.end(); return }
  try {
    let metadata = await stat(file).catch(() => undefined)
    if (metadata?.isDirectory()) { file = resolve(file, 'index.html'); metadata = await stat(file).catch(() => undefined) }
    if (!metadata?.isFile() && !extname(pathname)) { file = resolve(directory, 'index.html'); metadata = await stat(file).catch(() => undefined) }
    if (!metadata?.isFile()) { res.writeHead(404); res.end('Not found'); return }
    res.writeHead(200, {
      'content-type': mime[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': metadata.size,
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    })
    if (req.method === 'HEAD') { res.end(); return }
    const stream = createReadStream(file)
    stream.on('error', () => res.destroy())
    stream.pipe(res)
  } catch {
    if (!res.headersSent) res.writeHead(500)
    res.end()
  }
}

export function startGameServer(options: { port?: number; host?: string; staticDirectory?: string } = {}) {
  const game = createGameService()
  const staticDirectory = resolve(options.staticDirectory ?? resolve(dirname(fileURLToPath(import.meta.url)), '../dist'))
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://game.local').pathname
    if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/healthz') void game.handle(req, res)
    else void serveStatic(req, res, staticDirectory)
  })
  const port = options.port ?? Number(process.env.PORT ?? 8080)
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new RangeError('Invalid PORT')
  server.listen(port, options.host ?? process.env.HOST ?? '0.0.0.0', () => {
    console.log(`Game server listening on port ${port}`)
  })
  return server
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) startGameServer()
