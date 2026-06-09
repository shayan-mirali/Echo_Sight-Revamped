# EchoSight API

NestJS + Prisma backend for EchoSight.
- **Phase 1: authentication + settings sync.**
- **Phase 2: real-time sound pipeline** — the app streams mic audio over a WebSocket; the backend classifies it, applies the user's settings, and pushes back in-app alerts (persisted to history).

## Stack
- **NestJS 11** (TypeScript)
- **Prisma 6** ORM — **Postgres** everywhere (local via docker-compose, prod via Render/Neon)
- **JWT** access tokens + rotating, hashed **refresh tokens**
- **bcryptjs** password/OTP hashing
- **Socket.IO** WebSocket gateway for the live audio stream
- **nodemailer** SMTP for OTP email (logs to console in dev when SMTP is unset)

## Setup

```bash
cd backend
npm install
cp .env.example .env          # Windows: copy .env.example .env
docker compose up -d          # local Postgres (or point DATABASE_URL at any Postgres)
npm run prisma:generate
npm run prisma:push           # create tables from schema.prisma
npm run db:seed               # optional: demo user + sample alerts
npm run start:dev             # http://localhost:3000/api
```

## Tests
- `npm test` — Jest unit tests for the pure logic (classifier, audio features, frame validation, rate-limit guard, env/boot-guard). No DB or server needed, so they run in CI without infra.
- `node scripts/<name>-check.mjs` — contract checks against a **running** instance (settings/history sync, token refresh, OTP flow, sound pipeline, SMTP). These need the server + Postgres up.

## API

Base URL: `http://localhost:3000/api`

### Health
| Method | Path | Notes |
|---|---|---|
| GET | `/health` | unauthenticated probe → `{ status, db, uptime, timestamp }` (Render health check) |

### Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/register` | `{ email, password, registeredName }` | creates user + default settings, returns tokens |
| POST | `/auth/login` | `{ email, password }` | returns `{ user, accessToken, refreshToken }` |
| POST | `/auth/refresh` | `{ refreshToken }` | rotates tokens |
| POST | `/auth/logout` | `{ refreshToken }` | revokes the refresh token |
| POST | `/auth/password/forgot` | `{ email }` | sends OTP (logged in dev); always 200 |
| POST | `/auth/otp/verify` | `{ email, code }` | `{ valid }` — checks without consuming |
| POST | `/auth/password/reset` | `{ email, code, newPassword }` | consumes OTP, sets password, revokes sessions |

### Settings (requires `Authorization: Bearer <accessToken>`)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/me/settings` | — | `{ registeredName, themeMode, hapticIntensity, sensitivityThreshold, enabledClassifications }` |
| PATCH | `/me/settings` | any subset of the above | merges classification map |

### Alert history (requires `Authorization: Bearer <accessToken>`)
| Method | Path | Body | Notes |
|---|---|---|---|
| GET | `/me/alerts?limit=100` | — | recent alerts, newest first (`limit` 1–500) |
| DELETE | `/me/alerts/:id` | — | delete one alert (owner-scoped) |
| DELETE | `/me/alerts` | — | clear all of the user's alerts |

A persisted/streamed alert looks like:
```json
{ "id": "...", "label": "Siren", "confidence": 0.97, "angle": 212,
  "severity": "danger", "timestamp": "2026-06-05T03:54:00.000Z", "transcript": null }
```

## Real-time sound pipeline (WebSocket)

Namespace **`/sound`** (Socket.IO). The client authenticates on the handshake with
its access token, then streams mic audio; the backend pushes back `alert` events.

```js
const socket = io('http://<host>:3000/sound', { auth: { token: accessToken } });

socket.on('ready', ({ registeredName }) => {/* connected + settings loaded */});
socket.on('alert', (a) => {/* a is the alert object above */});

// stream ~256ms frames of 16-bit PCM (base64) as the mic produces them:
socket.emit('audio', { sampleRate: 16000, pcm16: '<base64 Int16LE>' });

// after the user changes settings via PATCH /me/settings:
socket.emit('settings:reload');
```

Pipeline per frame: **decode → classify → (Speech→Name Call upgrade) → apply the
user's `sensitivityThreshold` + `enabledClassifications` server-side → persist →
emit**. A per-label cooldown collapses a sustained source into one alert so history
isn't flooded.

### Classifier & the model seam
Classification is done by `HeuristicSoundClassifier` — real loudness + FFT band
features (no heavyweight ML deps), so it reacts to live audio today. It sits behind
the `SoundClassifier` interface (`SOUND_CLASSIFIER` provider in `sound.module.ts`):
swap that one provider for a trained model (YAMNet / TFLite export / hosted endpoint)
and nothing else changes. **Name Call** needs words, not just acoustics — wire a real
`SpeechTranscriber` (`SPEECH_TRANSCRIBER` provider, default `NoopTranscriber`) and a
Speech detection is upgraded to Name Call when the transcript contains the registered
name.

### Smoke test
With the server running: `node scripts/sound-smoke.mjs` — registers a user, streams
synthetic siren/horn/knock/speech/silence frames, and prints the alerts that surface.

## Tokens
- **Access token**: JWT, `JWT_ACCESS_TTL` (default 15m). Send as `Bearer`.
- **Refresh token**: opaque `"<id>.<secret>"`. The secret is bcrypt-hashed in the DB; refreshing rotates (old one is revoked).

## Hardening & limits
- **Auth rate limiting** — `login`/`register`/`password/*`/`otp/verify` are throttled per client IP (in-process fixed window, see `common/rate-limit.guard.ts`); over the limit returns **429** with `retryAfter`. Behind a proxy, set `TRUST_PROXY=true` so the real client IP is used.
- **WebSocket audio guards** — each `audio` frame is validated (sane sample rate, base64/size caps, finite samples) and per-connection **rate-limited** (`WS_MAX_FRAMES_PER_SEC`, default 30/s); the transport caps a single frame at `WS_MAX_FRAME_BYTES` (default 256 KB). A client that sends 20 invalid frames is disconnected.
- **CORS** — `CORS_ORIGIN` is a comma-separated allowlist (or `*` in dev), applied to both the REST API and the `/sound` namespace.
- **Production boot guard** — with `NODE_ENV=production`, the app **refuses to start** if `JWT_ACCESS_SECRET` is the dev default, `CORS_ORIGIN` is `*`, or `DATABASE_URL` is still SQLite. OTP codes are never logged in production.

See `.env.example` for every variable.

## Seed data
`npm run db:seed` creates an idempotent demo account (`demo@echosight.app` / `password123`) with default settings and a handful of sample alerts so the history screen isn't empty. Also runs automatically on `prisma migrate reset`. Dev only.

## Email (OTP delivery)
OTP codes are sent over SMTP via `NotificationsService` (nodemailer). Configure
`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` (see
`.env.example`). Port 465 uses implicit TLS; 587 uses STARTTLS. When SMTP is
unset the service degrades gracefully — in dev it logs the code to the console;
in production it warns and sends nothing. Sanity-check credentials with
`node scripts/smtp-verify.mjs` (verifies login without sending).

## Deploy (Render)
`render.yaml` is a Blueprint that deploys the whole thing: **New → Blueprint →
connect this repo**. Render provisions Postgres, wires `DATABASE_URL`, generates
`JWT_ACCESS_SECRET`, and runs the build/start commands. You only set the `SMTP_*`
secrets (marked `sync: false`) in the dashboard. The free web service spins down
when idle (~50s cold start); the app reconnects automatically.

> The blueprint's free Render Postgres is deleted ~30 days after creation. For a
> longer-lived free DB, drop the `databases:` block and paste a Neon connection
> string into a `sync: false` `DATABASE_URL` instead.

The production **boot guard** refuses to start unless `NODE_ENV=production` with a
non-default `JWT_ACCESS_SECRET`, a non-`*` `CORS_ORIGIN`, and a non-SQLite
`DATABASE_URL` — all satisfied by `render.yaml`.

Point the Flutter app at the deployed URL:
`flutter run --dart-define=ECHO_API_BASE=https://<your-service>.onrender.com`
