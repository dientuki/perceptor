import { toPrincipal, JwtPayload } from './auth.types';

// toPrincipal is the single seam that turns a decoded JWT payload into the
// object every resolver and guard trusts to decide what a caller may see.
// If it ever mislabeled a service payload as a user principal — or gave a
// service principal an `id` field by accident — a leaked machine credential
// (SERVICE_TOKEN, reachable from the worker and the qBittorrent container)
// would be able to resolve `me` or mint an upload ticket for an arbitrary
// user, with nothing in the request pipeline able to catch it. This is a
// pure function, so there is no excuse for that class of bug to reach a
// guard untested.
describe('toPrincipal', () => {
  it('maps a user payload to a user principal', () => {
    const payload: JwtPayload = { sub: '1', username: 'juan', jti: 'abc' };

    expect(toPrincipal(payload)).toEqual({ type: 'user', id: '1', username: 'juan' });
  });

  it('maps a service payload to a service principal carrying no id field at all', () => {
    const payload: JwtPayload = { sub: 'service:perceptor', typ: 'service' };

    const principal = toPrincipal(payload);

    expect(principal).toEqual({ type: 'service', name: 'service:perceptor' });
    expect('id' in principal).toBe(false);
  });

  it('never returns type "user" for a service payload', () => {
    const payload: JwtPayload = { sub: 'service:perceptor', typ: 'service' };

    expect(toPrincipal(payload).type).not.toBe('user');
  });

  it('never returns type "service" for a user payload', () => {
    const payload: JwtPayload = { sub: '1', username: 'juan', jti: 'abc' };

    expect(toPrincipal(payload).type).not.toBe('service');
  });
});
