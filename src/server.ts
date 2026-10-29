import handler from '@tanstack/react-start/server-entry'
import { DO_NAME } from '#/lib/heart-rate-types'

export { HeartRate } from './heart-rate'

async function isValidToken(token: string | null, expected: string | undefined) {
  if (!token || !expected) return false
  const enc = new TextEncoder()
  // Hash both so lengths match for timingSafeEqual
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(token)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  // Workers-specific API, missing from the DOM SubtleCrypto type
  return (crypto.subtle as unknown as { timingSafeEqual(a: ArrayBuffer, b: ArrayBuffer): boolean }).timingSafeEqual(a, b)
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const isBroadcaster = url.searchParams.get('role') === 'broadcaster'
      if (isBroadcaster && !(await isValidToken(url.searchParams.get('token'), env.BROADCAST_TOKEN))) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (request.headers.get('Upgrade') !== 'websocket') {
        // Plain GET lets the broadcaster page verify its token (browsers hide WS handshake errors)
        return isBroadcaster ? new Response(null, { status: 204 }) : new Response('Expected WebSocket', { status: 426 })
      }

      const headers = new Headers(request.headers)
      headers.delete('X-HR-Role')
      if (isBroadcaster) headers.set('X-HR-Role', 'broadcaster')

      return env.HEART_RATE.getByName(DO_NAME).fetch(new Request(request, { headers }))
    }

    return handler.fetch(request)
  },
} satisfies ExportedHandler<Env>
