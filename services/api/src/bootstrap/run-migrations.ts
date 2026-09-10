import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

export type SpawnFn = (command: string, args: string[]) => ChildProcess;

const PRISMA_CLI = 'node_modules/prisma/build/index.js';
const CONFIG_ARGS = ['--config', 'prisma/runtime.config.mjs'];

export const OPERATOR_MIGRATION_COMMAND = `docker compose exec api node ${PRISMA_CLI} migrate deploy ${CONFIG_ARGS.join(' ')}`;

export function runMigrations(spawnFn: SpawnFn = nodeSpawn): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnFn('node', [PRISMA_CLI, 'migrate', 'deploy', ...CONFIG_ARGS]);

    child.stdout?.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));

    child.on('error', (err) => {
      reject(
        new Error(
          `Could not start the migration process (${err.message}). Resolve it and run: ${OPERATOR_MIGRATION_COMMAND}`,
        ),
      );
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `Prisma migration failed (exit code ${code}). Resolve it and run: ${OPERATOR_MIGRATION_COMMAND}`,
        ),
      );
    });
  });
}
