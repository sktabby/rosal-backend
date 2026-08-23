import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SearchService {
  constructor(private prisma: PrismaService) {}

  async globalSearch(q: string) {
    if (!q || q.trim().length === 0) {
      return { users: [], clients: [], products: [], transport: [], factoryUnits: [] };
    }
    const contains = { contains: q, mode: 'insensitive' as const };

    const [users, clients, products, transport, factoryUnits] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          deletedAt: null,
          OR: [{ firstName: contains }, { lastName: contains }, { employeeCode: contains }, { generatedId: contains }],
        },
        take: 10,
      }),
      this.prisma.client.findMany({
        where: {
          deletedAt: null,
          OR: [{ firstName: contains }, { lastName: contains }, { gstin: contains }],
        },
        take: 10,
      }),
      this.prisma.product.findMany({
        where: { deletedAt: null, name: contains },
        take: 10,
      }),
      this.prisma.transport.findMany({
        where: { deletedAt: null, name: contains },
        take: 10,
      }),
      this.prisma.factoryUnit.findMany({
        where: { deletedAt: null, name: contains },
        take: 10,
      }),
    ]);

    return {
      users: users.map(({ passwordHash, ...u }) => u),
      clients,
      products,
      transport,
      factoryUnits,
    };
  }
}
