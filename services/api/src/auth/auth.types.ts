// The two JWT payload shapes this service issues, and the pure mapping from
// either one to the principal resolvers and guards actually see.

export type UserJwtPayload = {
  sub: string;
  username: string;
  jti: string;
  typ?: 'user';
};

export type ServiceJwtPayload = {
  sub: string;
  typ: 'service';
};

export type JwtPayload = UserJwtPayload | ServiceJwtPayload;

export type AuthPrincipal =
  | { type: 'user'; id: string; username: string }
  | { type: 'service'; name: string };

/**
 * Pure mapping from a decoded JWT payload to the principal attached to the
 * request. The branch on `typ === 'service'` is the security hinge of this
 * feature: a service payload must come out with no `id` field at all,
 * structurally — not `undefined`, absent — so a leaked machine credential
 * can never resolve a user by accident, whether in `me`,
 * `createUploadTicket`, or a future resolver that trusts `principal.id`
 * without first checking `principal.type`.
 */
export function toPrincipal(payload: JwtPayload): AuthPrincipal {
  if (payload.typ === 'service') {
    return { type: 'service', name: payload.sub };
  }
  return { type: 'user', id: payload.sub, username: payload.username };
}
