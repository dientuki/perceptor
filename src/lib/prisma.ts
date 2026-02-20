import "dotenv/config";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client"
import { logger } from "./logger";

const connectionString = `${process.env.DATABASE_URL}`;
logger.info(
  { connectionString },
  'Connecting to database'
);

const adapter = new PrismaBetterSqlite3({ url: connectionString });
const prisma = new PrismaClient({ adapter });

export { prisma };