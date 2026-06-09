import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';

import { defaultEnabledClassifications } from '../common/defaults';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Creates a user together with a default settings row in a single
   * transaction so a user always has settings to sync.
   */
  async createWithDefaults(params: {
    email: string;
    passwordHash: string;
    registeredName: string;
  }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: params.email,
        passwordHash: params.passwordHash,
        registeredName: params.registeredName,
        settings: {
          create: {
            enabledClassifications: JSON.stringify(
              defaultEnabledClassifications(),
            ),
          },
        },
      },
    });
  }

  updatePassword(userId: string, passwordHash: string): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }
}
