import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

const isProduction = process.env.NODE_ENV === 'production';

const databaseUrl = process.env.DATABASE_URL || '';
const separator = databaseUrl.includes('?') ? '&' : '?';
const connectionUrl = `${databaseUrl}${separator}connect_timeout=30&pool_timeout=30`;

export const db = global.prisma || new PrismaClient({
  log: isProduction ? [] : ['query'],
  datasources: {
    db: {
      url: connectionUrl,
    },
  },
});

if (!isProduction) {
  global.prisma = db;
}
