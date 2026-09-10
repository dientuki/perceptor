import { PrismaClient } from '@prisma/client';
import { seedProduction } from './production-seed';

// This suite exists because otherwise a regression from the create-only
// settings loop to a bare `upsert` fails with no error anywhere: the
// production seed now runs on *every* boot (REQ-10/REQ-11), so an `upsert`
// would silently wipe a user's `movie_db_api_key` (or any other configured
// setting) back to its seed default on the next update, and the app would
// start failing TMDB calls with 401 with nothing in any log pointing at the
// seed as the cause. Driven against a fake, in-memory Prisma client — real
// enough to exercise findUnique/create/update, without needing a database —
// because the property under test is the branching logic itself, not
// anything Prisma does for us.
describe('seedProduction — settings create-only loop', () => {
  const originalAdminUser = process.env.ADMIN_USER;
  const originalAdminPassword = process.env.ADMIN_PASSWORD;
  const originalTmdbKey = process.env.TMDB_API_KEY;

  beforeEach(() => {
    process.env.ADMIN_USER = 'admin';
    process.env.ADMIN_PASSWORD = 'changeme';
  });

  afterEach(() => {
    process.env.ADMIN_USER = originalAdminUser;
    process.env.ADMIN_PASSWORD = originalAdminPassword;
    if (originalTmdbKey === undefined) {
      delete process.env.TMDB_API_KEY;
    } else {
      process.env.TMDB_API_KEY = originalTmdbKey;
    }
  });

  function makeFakePrisma(existingSettings: Record<string, string> = {}): PrismaClient {
    const languages = new Map<string, unknown>();
    const users = new Map<string, unknown>();
    const settings = new Map<string, { key: string; value: string }>();
    for (const [key, value] of Object.entries(existingSettings)) {
      settings.set(key, { key, value });
    }

    return {
      language: {
        findUnique: async ({ where: { tag } }: { where: { tag: string } }) => languages.get(tag) ?? null,
        create: async ({ data }: { data: { tag: string } }) => {
          languages.set(data.tag, data);
          return data;
        },
      },
      user: {
        upsert: async ({ where: { username }, create }: { where: { username: string }; create: unknown }) => {
          if (!users.has(username)) {
            users.set(username, create);
          }
          return users.get(username);
        },
      },
      setting: {
        findUnique: async ({ where: { key } }: { where: { key: string } }) => settings.get(key) ?? null,
        create: async ({ data }: { data: { key: string; value: string } }) => {
          settings.set(data.key, data);
          return data;
        },
        update: async ({ where: { key }, data }: { where: { key: string }; data: { value: string } }) => {
          const updated = { key, value: data.value };
          settings.set(key, updated);
          return updated;
        },
      },
      __settings: settings,
    } as unknown as PrismaClient & { __settings: Map<string, { key: string; value: string }> };
  }

  it('creates an absent key at its default (or env-backfilled) value', async () => {
    delete process.env.TMDB_API_KEY;
    process.env.TMDB_API_KEY = 'fresh-tmdb-key';

    const prisma = makeFakePrisma() as PrismaClient & { __settings: Map<string, { key: string; value: string }> };
    await seedProduction(prisma);

    expect(prisma.__settings.get('movie_db_api_key')?.value).toBe('fresh-tmdb-key');
  });

  it('leaves an existing key holding a user value untouched, even if TMDB_API_KEY differs', async () => {
    process.env.TMDB_API_KEY = 'a-different-key-from-env';

    const prisma = makeFakePrisma({ movie_db_api_key: 'the-users-real-key' }) as PrismaClient & {
      __settings: Map<string, { key: string; value: string }>;
    };
    await seedProduction(prisma);

    expect(prisma.__settings.get('movie_db_api_key')?.value).toBe('the-users-real-key');
  });

  it('backfills an existing key that is still empty', async () => {
    process.env.TMDB_API_KEY = 'backfilled-key';

    const prisma = makeFakePrisma({ movie_db_api_key: '' }) as PrismaClient & {
      __settings: Map<string, { key: string; value: string }>;
    };
    await seedProduction(prisma);

    expect(prisma.__settings.get('movie_db_api_key')?.value).toBe('backfilled-key');
  });

  it('fails if the loop were a bare upsert: re-running with a new env value must not clobber a stored one', async () => {
    process.env.TMDB_API_KEY = 'first-run-key';
    const prisma = makeFakePrisma() as PrismaClient & { __settings: Map<string, { key: string; value: string }> };
    await seedProduction(prisma);
    expect(prisma.__settings.get('movie_db_api_key')?.value).toBe('first-run-key');

    // Simulate a user editing the setting after the first boot.
    prisma.__settings.set('movie_db_api_key', { key: 'movie_db_api_key', value: 'user-edited-key' });

    process.env.TMDB_API_KEY = 'second-run-key';
    await seedProduction(prisma);

    expect(prisma.__settings.get('movie_db_api_key')?.value).toBe('user-edited-key');
  });
});
