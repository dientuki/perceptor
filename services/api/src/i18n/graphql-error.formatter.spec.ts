import { INestApplication, InternalServerErrorException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule, Query, Resolver } from '@nestjs/graphql';
import request from 'supertest';

import { ERROR_KEYS } from '@/i18n/error-keys';
import { formatGraphQLError } from '@/i18n/graphql-error.formatter';
import { i18nError } from '@/i18n/i18n-error';

/**
 * `formatError` is the only thing standing between a keyed `i18nError.*`
 * throw and a raw English sentence on the wire — if it silently fails to
 * lift `i18n` into `extensions`, every consumer (`web`'s `auth-session.ts`
 * matching on `error.auth.session_expired`, `worker` persisting a key onto
 * `ProcessJob`) falls back to English forever, and the feature looks like
 * it works in development where the developer's own browser is English
 * anyway (`api/plan.md` § Tests).
 *
 * This runs a real Nest + `@nestjs/apollo` application end to end — not a
 * mock of `formatError`'s inputs — because the exact shape Apollo hands the
 * function is itself load-bearing for every throw-site rewrite after this
 * task and for the `web`/`worker` consumers of `extensions.i18n`.
 */
@Resolver()
class TestResolver {
  @Query(() => String)
  keyedError(): string {
    throw i18nError.notFound(ERROR_KEYS.MOVIE_NOT_FOUND, { id: 42 });
  }

  @Query(() => String)
  keyedErrorNoParams(): string {
    throw i18nError.unauthorized(ERROR_KEYS.AUTH_UNAUTHENTICATED);
  }

  @Query(() => String)
  unexpectedError(): string {
    throw new Error('boom');
  }

  @Query(() => String)
  unexpectedHttpException(): string {
    // A plain HttpException with a string response — the shape every throw
    // site in this codebase used before 018, and still what a bug or an
    // un-migrated call site produces. It must not gain an invented i18n key.
    throw new InternalServerErrorException('database exploded');
  }
}

describe('formatGraphQLError', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          autoSchemaFile: true,
          formatError: formatGraphQLError,
        }),
      ],
      providers: [TestResolver],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('lifts extensions.i18n.key and .params from a keyed HttpException onto the wire', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ keyedError }' });

    const error = res.body.errors[0];
    expect(error.message).toBe('Movie 42 does not exist');
    expect(error.extensions.i18n).toEqual({
      key: ERROR_KEYS.MOVIE_NOT_FOUND,
      params: { id: 42 },
    });
  });

  it('omits params when the key takes none', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ keyedErrorNoParams }' });

    const error = res.body.errors[0];
    expect(error.extensions.i18n).toEqual({ key: ERROR_KEYS.AUTH_UNAUTHENTICATED });
    expect(error.extensions.i18n.params).toBeUndefined();
  });

  it('passes a bare Error through without inventing an i18n extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ unexpectedError }' });

    const error = res.body.errors[0];
    expect(error.extensions.i18n).toBeUndefined();
  });

  it('passes an un-migrated HttpException (string response) through without inventing an i18n extension', async () => {
    const res = await request(app.getHttpServer())
      .post('/graphql')
      .send({ query: '{ unexpectedHttpException }' });

    const error = res.body.errors[0];
    expect(error.message).toBe('database exploded');
    expect(error.extensions.i18n).toBeUndefined();
  });
});
