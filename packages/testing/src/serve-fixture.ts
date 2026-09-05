import { serveFixture } from './fixture-server'

const port = Number(process.env['PORT'] ?? 4177)
serveFixture(undefined, port)
  .then((s) => console.log(`fixture dApp at ${s.url}`))
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
