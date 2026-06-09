import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { SettingsModule } from '../settings/settings.module';
import { HeuristicSoundClassifier } from './classifier/heuristic-sound-classifier';
import { SOUND_CLASSIFIER } from './classifier/sound-classifier.interface';
import {
  NoopTranscriber,
  SPEECH_TRANSCRIBER,
} from './classifier/speech-transcriber.interface';
import { SoundController } from './sound.controller';
import { SoundGateway } from './sound.gateway';
import { SoundService } from './sound.service';

@Module({
  imports: [
    SettingsModule, // for server-side settings application in the gateway
    // The gateway verifies the access token on the WS handshake, so it needs
    // the same JWT config as AuthModule.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_ACCESS_SECRET') ??
          'dev-access-secret-change-me',
      }),
    }),
  ],
  controllers: [SoundController],
  providers: [
    SoundService,
    SoundGateway,
    // The model seam: swap these providers to drop in a real classifier/ASR.
    { provide: SOUND_CLASSIFIER, useClass: HeuristicSoundClassifier },
    { provide: SPEECH_TRANSCRIBER, useClass: NoopTranscriber },
  ],
})
export class SoundModule {}
