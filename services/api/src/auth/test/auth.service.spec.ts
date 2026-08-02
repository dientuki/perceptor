import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let jwtService: JwtService;

  // Mock de JwtService para aislar las pruebas
  const mockJwtService = {
    sign: jest.fn().mockReturnValue('mocked_jwt_token'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jwtService = module.get<JwtService>(JwtService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user object without password if credentials are valid', async () => {
      const user = await service.validateUser('admin', 'admin123');

      expect(user).toBeDefined();
      expect(user.username).toBe('admin');
      expect(user.id).toBe('usr_123');
      expect((user as any).pass).toBeUndefined(); // Verifica que no retorne la clave
    });

    it('should return null if password is incorrect', async () => {
      const user = await service.validateUser('admin', 'wrong_pass');
      expect(user).toBeNull();
    });

    it('should return null if username does not exist', async () => {
      const user = await service.validateUser('unknown', 'admin123');
      expect(user).toBeNull();
    });
  });

  describe('login', () => {
    it('should generate a JWT access token for valid user', async () => {
      const inputUser = { id: 'usr_123', username: 'admin' };
      const result = await service.login(inputUser);

      expect(jwtService.sign).toHaveBeenCalledWith({
        username: inputUser.username,
        sub: inputUser.id,
      });

      expect(result).toEqual({
        access_token: 'mocked_jwt_token',
        user: inputUser,
      });
    });
  });
});