# Jilles Live Heart Rate

Garmin Forerunner 965 → Web Bluetooth (Chrome on macOS) → Cloudflare Durable Object → everyone at https://hr.jilles.fyi

It works with any device that broadcasts the standard Bluetooth Heart Rate service. I've tested it with:

- **Garmin Forerunner 965**: turn on Broadcast Heart Rate on the watch
- **Whoop**: turn on Heart Rate Broadcast in the Whoop app (Device Settings)

Most chest straps (Polar, Wahoo, Garmin HRM) and other watches with HR broadcast should work too.

## How it works

- `src/heart-rate.ts` is the `HeartRate` Durable Object (one instance, `jilles`). It keeps the latest BPM, the last update time and ~5 min of history in SQLite-backed KV storage. Viewers and the broadcaster connect with hibernatable WebSockets.
- `src/server.ts` is the custom Worker entry. It sends `/ws` to the DO (broadcasters must pass `BROADCAST_TOKEN`) and everything else to TanStack Start.
- `/` is the public viewer. It's server-rendered from DO RPC (`getState`/`getHistory`) and then gets live updates over the WebSocket.
- `/broadcast` connects to the watch's standard BLE Heart Rate service and forwards every reading.
- The viewer shows "Jilles HR monitor currently not connected" in these cases: the broadcaster socket closes, the watch disconnects, or no reading arrives for 10s (checked with a DO alarm).

## Run locally

```bash
cp .dev.vars.example .dev.vars   # set BROADCAST_TOKEN
pnpm install
pnpm dev
```

Open http://localhost:3000/broadcast in Chrome, enter the token, then click "Connect watch". Open http://localhost:3000 to watch.

Start broadcasting from your device:

- **Garmin Forerunner 965**: hold UP → Health & Wellness → Wrist Heart Rate → Broadcast Heart Rate → press START
- **Whoop**: Whoop app → Device Settings → Heart Rate Broadcast → on

You don't need to pair in macOS Bluetooth settings because Chrome's device chooser handles it.

## Deploy

```bash
npx wrangler secret put BROADCAST_TOKEN
pnpm deploy
```

`wrangler.jsonc` attaches the custom domains `hr.jilles.fyi` and `heartrate.jilles.fyi`. The `jilles.fyi` zone must be on the same Cloudflare account.
