/**
 * Serves the fixture dApp (a static directory) on a loopback port so Playwright
 * can load it as an `http://` origin — extensions do not inject into `file://`.
 */
import { readFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

export const FIXTURE_DAPP_DIR = fileURLToPath(new URL('../fixtures/dapp/', import.meta.url))

export interface FixtureServer {
  readonly url: string
  close(): Promise<void>
}

export async function serveFixture(
  dir: string = FIXTURE_DAPP_DIR,
  port = 0,
): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const path =
        normalize(new URL(req.url ?? '/', 'http://x').pathname).replace(/^\/+/, '') || 'index.html'
      const file = join(dir, path.endsWith('/') ? `${path}index.html` : path)
      if (!file.startsWith(dir)) {
        res.writeHead(403)
        res.end()
        return
      }
      try {
        const body = await readFile(file)
        res.writeHead(200, {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'cache-control': 'no-store',
        })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
    })()
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  const address = server.address()
  const p = typeof address === 'object' && address ? address.port : port
  return {
    url: `http://127.0.0.1:${p}/`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  }
}
