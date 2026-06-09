import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';

import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { SettingsService } from '../settings/settings.service';
import { FrameRateLimiter, validateFramePayload } from './audio-frame.validation';
import { SoundService, UserSoundSettings } from './sound.service';
import { AudioFramePayload } from './sound.types';

/**
 * Transport-level guards, read from the environment at module load (the
 * `@WebSocketGateway` decorator runs before DI, so this can't use ConfigService).
 *  - `maxHttpBufferSize` caps the raw bytes of any single Socket.IO message,
 *    rejecting oversized frames before they hit our code.
 *  - CORS mirrors the HTTP `CORS_ORIGIN` policy.
 */
const WS_MAX_FRAME_BYTES = Number(process.env.WS_MAX_FRAME_BYTES) || 256 * 1024;
const WS_CORS_ORIGIN = (() => {
  const raw = (process.env.CORS_ORIGIN ?? '*').trim();
  if (raw === '*' || raw === '') return '*';
  return raw.split(',').map((o) => o.trim()).filter(Boolean);
})();

/** Per-socket state we keep alongside the connection. */
interface SoundSocketData {
  userId: string;
  settings: UserSoundSettings;
  /** label -> last surfaced timestamp (ms), for cooldown debouncing. */
  lastAlertAt: Record<string, number>;
  /** Per-connection frame-rate limiter (anti-flood). */
  rate: FrameRateLimiter;
  /** Count of rejected frames — a persistently bad client gets disconnected. */
  rejects: number;
}

type SoundSocket = Socket & { data: SoundSocketData };

/**
 * Real-time sound pipeline.
 *
 * The Flutter app captures mic audio and connects here with its access token:
 *
 *   const socket = io('http://<host>:3000/sound', { auth: { token } });
 *   socket.emit('audio', { sampleRate: 16000, pcm16: <base64 Int16LE> });
 *   socket.on('alert', (a) => ...);   // a == SoundAlertEvent
 *
 * Auth is enforced on the handshake; settings are loaded once per connection
 * (refreshable via the `settings:reload` message) and applied server-side.
 * Audio frames are validated + rate-limited per connection so a buggy or
 * hostile client can't flood the classifier.
 */
@WebSocketGateway({
  namespace: '/sound',
  cors: { origin: WS_CORS_ORIGIN },
  maxHttpBufferSize: WS_MAX_FRAME_BYTES,
})
export class SoundGateway implements OnGatewayConnection {
  private readonly logger = new Logger(SoundGateway.name);

  /** Don't re-surface the same label more often than this (ms). */
  private static readonly COOLDOWN_MS = 1500;

  /** Frame-rate cap: a client streaming sane ~4 frames/s stays well under this. */
  private static readonly MAX_FRAMES_PER_WINDOW =
    Number(process.env.WS_MAX_FRAMES_PER_SEC) || 30;
  private static readonly RATE_WINDOW_MS = 1000;

  /** Disconnect a socket once it has sent this many invalid frames. */
  private static readonly MAX_REJECTS = 20;

  constructor(
    private readonly sound: SoundService,
    private readonly settings: SettingsService,
    private readonly jwt: JwtService,
  ) {}

  async handleConnection(client: SoundSocket): Promise<void> {
    try {
      const token = this.extractToken(client);
      const payload = await this.jwt.verifyAsync<JwtPayload>(token);

      const s = await this.settings.get(payload.sub);
      client.data = {
        userId: payload.sub,
        settings: {
          registeredName: s.registeredName,
          sensitivityThreshold: s.sensitivityThreshold,
          enabledClassifications: s.enabledClassifications,
        },
        lastAlertAt: {},
        rate: new FrameRateLimiter(
          SoundGateway.MAX_FRAMES_PER_WINDOW,
          SoundGateway.RATE_WINDOW_MS,
        ),
        rejects: 0,
      };

      client.emit('ready', { registeredName: s.registeredName });
      this.logger.log(`Sound stream connected: user ${payload.sub}`);
    } catch (err) {
      this.logger.warn(`Rejected sound connection: ${(err as Error).message}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  /** A chunk of mic audio. Returns an `alert` event if one surfaces. */
  @SubscribeMessage('audio')
  async onAudio(
    @ConnectedSocket() client: SoundSocket,
    @MessageBody() payload: AudioFramePayload,
  ): Promise<void> {
    const data = client.data;
    if (!data?.userId) return;

    // Reject malformed/oversized frames before doing any audio work.
    const check = validateFramePayload(payload);
    if (!check.ok) {
      if (++data.rejects >= SoundGateway.MAX_REJECTS) {
        this.logger.warn(
          `Disconnecting user ${data.userId}: too many invalid frames (last: ${check.reason})`,
        );
        client.emit('error', { message: 'Invalid audio stream' });
        client.disconnect(true);
      }
      return;
    }

    // Anti-flood: silently drop frames that exceed the per-second budget.
    if (!data.rate.allow(Date.now())) return;

    const candidate = await this.sound.analyzeFrame(data.settings, payload);
    if (!candidate) return;

    // Cooldown: collapse a sustained sound into one alert per window — checked
    // BEFORE persisting so history isn't flooded by a continuous source.
    const now = Date.now();
    const last = data.lastAlertAt[candidate.label] ?? 0;
    if (now - last < SoundGateway.COOLDOWN_MS) return;
    data.lastAlertAt[candidate.label] = now;

    const event = await this.sound.record(data.userId, candidate);
    client.emit('alert', event);
  }

  /** Re-pull settings after the user changes them in the app. */
  @SubscribeMessage('settings:reload')
  async onSettingsReload(@ConnectedSocket() client: SoundSocket): Promise<void> {
    if (!client.data?.userId) return;
    const s = await this.settings.get(client.data.userId);
    client.data.settings = {
      registeredName: s.registeredName,
      sensitivityThreshold: s.sensitivityThreshold,
      enabledClassifications: s.enabledClassifications,
    };
    client.emit('settings:reloaded');
  }

  private extractToken(client: Socket): string {
    const fromAuth = (client.handshake.auth as { token?: string })?.token;
    const fromQuery = client.handshake.query?.token;
    const token = fromAuth ?? (Array.isArray(fromQuery) ? fromQuery[0] : fromQuery);
    if (!token) throw new Error('Missing access token');
    return token;
  }
}
