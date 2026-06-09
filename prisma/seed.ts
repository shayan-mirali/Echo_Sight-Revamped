/**
 * Idempotent dev seed: a demo account with default settings and a few sample
 * sound alerts so the history screen has something to show on first run.
 *
 *   npm run db:seed
 *
 * Safe to run repeatedly — it upserts the demo user and only adds sample
 * alerts when that user has none. NOT for production (uses a known password).
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { defaultEnabledClassifications } from '../src/common/defaults';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@echosight.app';
const DEMO_PASSWORD = 'password123';
const DEMO_NAME = 'Alex';

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      passwordHash,
      registeredName: DEMO_NAME,
      verified: true,
      settings: {
        create: {
          enabledClassifications: JSON.stringify(defaultEnabledClassifications()),
        },
      },
    },
  });

  const existing = await prisma.soundAlert.count({ where: { userId: user.id } });
  if (existing === 0) {
    await prisma.soundAlert.createMany({
      data: [
        { userId: user.id, label: 'Siren', confidence: 0.97, angle: 212, severity: 'danger' },
        { userId: user.id, label: 'Car Horn', confidence: 0.88, angle: 147, severity: 'danger' },
        { userId: user.id, label: 'Door Knock', confidence: 0.71, angle: 305, severity: 'warning' },
        { userId: user.id, label: 'Dog Bark', confidence: 0.66, angle: 58, severity: 'warning' },
        {
          userId: user.id,
          label: 'Name Call',
          confidence: 0.82,
          angle: 190,
          severity: 'info',
          transcript: `Hey ${DEMO_NAME}, over here!`,
        },
      ],
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Seeded demo user ${DEMO_EMAIL} (password: ${DEMO_PASSWORD}) with ` +
      `${existing === 0 ? 5 : existing} sample alert(s).`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
