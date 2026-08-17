// Mirrors the Language type from api's GraphQL schema — the languages table
// seeded by services/api/prisma/seeds/languages.ts.

export type Language = {
  id: string;
  iso2: string;
  iso3: string;
  name: string;
};
