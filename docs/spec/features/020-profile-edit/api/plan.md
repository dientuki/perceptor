---
title: Profile Edit — api slice
service: api
last_updated: 2026-08-19
status: Approved
---

# PLAN: Profile Edit — `api` (`api/plan.md`)

## Scope

This slice adds exactly one GraphQL mutation, `updateProfile`, which lets the authenticated caller
change their own `name`, `username` and password. It owns the whole server side of the feature:
input validation, the duplicate-username check, bcrypt hashing, and the refusal of anything that is
not a user principal.

It is **not** building any UI — `web` owns the modal, the form and both password-pair messages, and
it will call this mutation exactly as `../spec.md` § GraphQL Contract Delta describes. It is also
**not** touching the admin surface: `UsersResolver`, `UpdateUserInput`, `updateUser`, `createUser`
and `removeUser` behave exactly as they do today (NFR-1). There is **no Prisma schema change and no
migration** — if `git status services/api/prisma/` is non-empty at the end of this slice, something
was misread.

Writes are confined to `services/api/` and this directory. Anything else is a stop-and-report (see
`.claude/agents/api.md`).

## Files

| File | New / Modified | What changes |
| :-- | :-- | :-- |
| `services/api/src/users/dto/update-profile.input.ts` | New | `UpdateProfileInput` — `name`, `username`, optional `password`, one validator each. |
| `services/api/src/users/profile.resolver.ts` | New | `ProfileResolver` — the `updateProfile` mutation, target read from `@CurrentUser()`. |
| `services/api/src/users/users.service.ts` | Modified | New `updateProfile(userId, input)` method. Existing methods untouched. |
| `services/api/src/users/users.module.ts` | Modified | Register `ProfileResolver` in `providers`. |
| `services/api/src/users/users.service.spec.ts` | Modified | New `describe('updateProfile')` block — see § Tests. |
| `services/api/src/schema.gql` | Regenerated | Artifact only. Never hand-edited (Constitution, Article IV). |

## Existing code to reuse

- `src/users/users.service.ts` — `create()` shows the exact duplicate-username check
  (`findUnique({ where: { username } })` → `ConflictException('El nombre de usuario ya está
  registrado')`) and the exact hash (`bcrypt.hash(password, 10)`). `updateProfile()` reuses both,
  including the message string. Do not invent a second wording.
- `src/auth/decorators/current-user.decorator.ts` + `src/auth/auth.types.ts` — `@CurrentUser()`
  yields an `AuthPrincipal`, a union; narrow with `principal.type === 'user'` before reading `.id`,
  exactly as `AuthResolver.me` and `UsersResolver.removeUser` already do.
- `src/auth/resolvers` idiom — `AuthResolver.me` (`src/auth/auth.resolver.ts`) is the closest
  existing operation: `@UseGuards(JwtAuthGuard)`, no id argument, `UnauthorizedException('No
  autenticado')` for a non-user principal. Copy that shape.
- `src/users/dto/create-user.input.ts` — the three validator messages this feature reuses verbatim
  (`El nombre es requerido`, `El nombre de usuario debe tener al menos 3 caracteres`, `La contraseña
  debe tener al menos 6 caracteres`).
- `src/main.ts`'s `ValidationPipe` — `whitelist: true` strips any property with no validator
  decorator, and the custom `exceptionFactory` is what puts the class-validator message at
  `errors[0].message` where `web` reads it. Both are already configured; this slice only has to not
  break them, which means **every field of the new input carries a decorator**.
- `src/users/users.service.spec.ts` — the existing harness (mocked `PrismaService` +
  `SessionService`) extends directly; add a `describe` block, do not create a new spec file.

## Steps

1. **`dto/update-profile.input.ts`** — new `@InputType() class UpdateProfileInput` with:
   `name: string` (`@IsNotEmpty({ message: 'El nombre es requerido' })`),
   `username: string` (`@MinLength(3, { message: 'El nombre de usuario debe tener al menos 3
   caracteres' })`), and `password?: string` declared `@Field(() => String, { nullable: true })` with
   `@IsOptional()` **and** `@MinLength(6, { message: 'La contraseña debe tener al menos 6
   caracteres' })`. Note the interaction that makes the contract true: `@IsOptional()` skips
   validation for `undefined`/`null` only, so an empty string still hits `@MinLength(6)` and is
   rejected — which is what `../spec.md` promises. Do **not** extend `CreateUserInput` or
   `PartialType` of anything.
2. **`UsersService.updateProfile(userId: string, input: UpdateProfileInput): Promise<User>`**:
   1. Look up the username: `findUnique({ where: { username: input.username } })`. If a row comes
      back and its `id !== userId`, throw
      `ConflictException('El nombre de usuario ya está registrado')`. A row whose id **is** `userId`
      is the caller keeping their own username — that must succeed.
   2. Build the update payload **explicitly**: `const data: Prisma.UserUpdateInput = { name:
      input.name, username: input.username }`, then `if (input.password) data.password = await
      bcrypt.hash(input.password, 10)`. Never spread `input` into `data` — see `../plan.md` § Risks,
      first row. Nothing else may be assigned to `data`, ever.
   3. `prisma.user.update({ where: { id: userId }, data })`. Catch a `P2002` unique-constraint
      violation (two saves racing on the same free username) and rethrow it as the same
      `ConflictException` as step 1, so the race and the check produce one message rather than a
      raw Prisma error reaching the browser.
3. **`profile.resolver.ts`** — `@Resolver(() => User)` + `@UseGuards(JwtAuthGuard)` on the class
   (redundant with the global `APP_GUARD` and deliberate — see `../plan.md` § Decisions), one
   `@Mutation(() => User) updateProfile(@Args('updateProfileInput') input: UpdateProfileInput,
   @CurrentUser() principal: AuthPrincipal)`. Narrow the principal; a non-user principal throws
   `UnauthorizedException('No autenticado')` the way `me` does. **No `AdminGuard`, no `id` argument,
   ever.**
4. **`users.module.ts`** — add `ProfileResolver` to `providers`. `AuthModule` is already imported and
   supplies everything the guard and decorator need; do not add imports to the module.
5. **Boot the api and read the regenerated `src/schema.gql`** — the emitted `UpdateProfileInput` and
   `updateProfile` must match `../spec.md` § GraphQL Contract Delta character for character
   (Constitution, Article VIII's Check). A difference means step 1 or 3 is wrong; fix the decorator,
   never the file.

## Contract obligations

Exposed by this slice, exactly as frozen in `../spec.md`:

```graphql
input UpdateProfileInput {
  name: String!
  username: String!
  password: String
}

type Mutation {
  updateProfile(updateProfileInput: UpdateProfileInput!): User!
}
```

- The argument name is `updateProfileInput`, matching how `web` will send its `variables`. Renaming
  it to `input` is a runtime-only break in `web` — there is no codegen (see
  `docs/spec/graphql-contract.md`).
- The five error conditions in `../spec.md`'s table are this slice's obligation to produce, with
  those exact Spanish strings, at `errors[0].message`. Four of the five already exist elsewhere in
  this service; reuse them literally.
- The return type is the existing `User`. Do not add fields to it. `preferredLanguages` keeps
  resolving through `AuthResolver`'s identity-guarded `@ResolveField` untouched.

The delta is read-only. If it is wrong, stop and report — do not adapt it locally.

## Tests

`src/users/users.service.spec.ts` gains a `describe('updateProfile')` block. This is owed under
Article IX: three of the four cases cover failures that produce **no error anywhere**.

- **Assigns only `name`, `username` and (when given) `password`.** Assert the object handed to
  `prisma.user.update` has exactly those keys. Defends against the silent privilege escalation in
  `../plan.md` § Risks row 1 — a future `...input` spread makes this fail, and nothing else in the
  codebase would.
- **Hashes the password.** Assert the written value is not the submitted string and that
  `bcrypt.compare(submitted, written)` is true. The same bug this suite's header already documents
  for `update()`: a plaintext write succeeds, and the failure only appears at the next login.
- **Omits `password` entirely when the input has none.** Assert the key is absent from the update
  payload — not present-and-undefined. Guards the "quietly destroyed hash" row.
- **Accepts the caller's own current username.** The uniqueness check must exclude the caller;
  without this case a name-only edit is rejected forever with a confusing message.
- **Rejects a username belonging to someone else** with `ConflictException` and the exact string.

`profile.resolver.ts` gets **no spec**: it is argument plumbing plus a principal narrowing whose
failure is loud (`UnauthorizedException`) and already covered end-to-end by AC-9. `update-profile.input.ts`
gets none either — it is decorators, exercised through the pipe by AC-8. Do not extend or imitate
`users.resolver.spec.ts` (`nest g` scaffolding, see `services/api/CLAUDE.md`).

## Done when

```bash
bin/cli api npx --no tsc --noEmit
bin/npm api test
```

`tsc` reports **0 errors** (report the count before and after). `bin/npm api test` passes with the
suite count unchanged at **16** and the case count up by the five new ones. `git status
services/api/prisma/` is empty. `src/schema.gql` shows the new input and mutation and nothing else.
