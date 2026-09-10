import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { runMigrations, OPERATOR_MIGRATION_COMMAND } from './run-migrations';

// This suite exists because otherwise a resolve-on-any-exit bug in the
// boot-time migration step produces no error anywhere (NFR-2): the health
// check goes green, web and worker start on the strength of it, and the
// failure only surfaces later as an unrelated query error against a
// half-migrated schema. Driven through the injected spawn seam with a fake
// child process, so the failure path is exercised without a real database
// or a real prisma CLI.
describe('runMigrations', () => {
  function fakeChild(): ChildProcess {
    const child = new EventEmitter() as unknown as ChildProcess;
    (child as unknown as { stdout: EventEmitter }).stdout = new EventEmitter();
    (child as unknown as { stderr: EventEmitter }).stderr = new EventEmitter();
    return child;
  }

  it('rejects when the migration process exits non-zero, naming the operator command', async () => {
    const child = fakeChild();
    const spawnFn = jest.fn().mockReturnValue(child);

    const promise = runMigrations(spawnFn);
    child.emit('exit', 1);

    await expect(promise).rejects.toThrow(OPERATOR_MIGRATION_COMMAND);
  });

  it('resolves when the migration process exits zero', async () => {
    const child = fakeChild();
    const spawnFn = jest.fn().mockReturnValue(child);

    const promise = runMigrations(spawnFn);
    child.emit('exit', 0);

    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects if the process could never be spawned at all', async () => {
    const child = fakeChild();
    const spawnFn = jest.fn().mockReturnValue(child);

    const promise = runMigrations(spawnFn);
    child.emit('error', new Error('ENOENT'));

    await expect(promise).rejects.toThrow(OPERATOR_MIGRATION_COMMAND);
  });
});
