// Mirrors the `User` type from api's GraphQL schema (see users/entities/user.entity.ts).

export type AdminUser = {
  id: string;
  name: string;
  username: string;
  isAdmin: boolean;
};
