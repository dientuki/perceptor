import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../app.module';

describe('AuthModule (e2e) - GraphQL + Cookies', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Importante: Habilitar el middleware de cookies en el entorno de testing
    app.use(cookieParser());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Unauthenticated Access', () => {
    it('should fail when querying "me" without logging in', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            query {
              me
            }
          `,
        });

      // Debe retornar error de GraphQL / Unauthorized (401)
      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('Unauthorized');
    });
  });

  describe('2. Login Flow', () => {
    it('should fail login with wrong credentials', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation {
              login(username: "admin", pass: "wrongpass")
            }
          `,
        });

      expect(response.body.errors).toBeDefined();
      expect(response.body.errors[0].message).toContain('Credenciales inválidas');
    });

    it('should login successfully and return a Set-Cookie header', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation {
              login(username: "admin", pass: "admin123")
            }
          `,
        });

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.login).toBe(true);

      // Verificar que el header Set-Cookie contenga la cookie 'token'
      const cookies = response.headers['set-cookie'];
      expect(cookies).toBeDefined();
      expect(cookies[0]).toMatch(/^token=/);
    });
  });

  describe('3. Authenticated Session Flow', () => {
    let authCookie: string;

    beforeEach(async () => {
      // Hacer login previo para obtener la cookie
      const loginResponse = await request(app.getHttpServer())
        .post('/graphql')
        .send({
          query: `
            mutation {
              login(username: "admin", pass: "admin123")
            }
          `,
        });

      authCookie = loginResponse.headers['set-cookie'][0];
    });

    it('should return user info when "me" is called with valid cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/graphql')
        .set('Cookie', [authCookie]) // Enviamos la cookie recibida en el login
        .send({
          query: `
            query {
              me
            }
          `,
        });

      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.me).toBe('admin');
    });

    it('should logout and clear the session cookie', async () => {
      const logoutResponse = await request(app.getHttpServer())
        .post('/graphql')
        .set('Cookie', [authCookie])
        .send({
          query: `
            mutation {
              logout
            }
          `,
        });

      expect(logoutResponse.body.data.logout).toBe(true);

      // Verificar que el Set-Cookie expire la cookie (limpieza de sesión)
      const cookies = logoutResponse.headers['set-cookie'];
      expect(cookies[0]).toMatch(/token=;/);
    });
  });
});