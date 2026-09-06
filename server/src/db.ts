import ws from 'ws';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from './generated/prisma/client';

import { config } from './config';

neonConfig.webSocketConstructor = ws;

const adapter = new PrismaNeon({ connectionString: config.databaseUrl });

export const prisma = new PrismaClient({ adapter });
