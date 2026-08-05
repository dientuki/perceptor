// src/lib/config.ts
export const CONFIG = {
  authTtoken: "auth_token",
  graphqlUrl: process.env.INTERNAL_GRAPHQL_URL || 'http://api:4000/graphql',
} as const;