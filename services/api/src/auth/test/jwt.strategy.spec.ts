import { JwtStrategy } from '../strategies/jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    strategy = new JwtStrategy();
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should map JWT payload to request user object', async () => {
      const payload = { sub: 'usr_123', username: 'admin' };
      const result = await strategy.validate(payload);

      expect(result).toEqual({
        id: 'usr_123',
        username: 'admin',
      });
    });
  });
});