// The only password recovery path this app has (REQ-7): there is no SMTP
// service in docker-compose.yaml, so a locked-out administrator has nothing
// else to fall back on short of re-seeding the database. Run standalone via
// `npm run password:reset -- <username>`, through the container, per the
// root CLAUDE.md's Docker-first rule — never on the host.
//
// Relative import into src/, matching prisma/seeds/index.ts and
// scripts/mint-service-token.ts's convention: this script runs via bare
// `ts-node`, with no tsconfig-paths register step, so the `@/*` alias used
// inside src/ is not available here.
import * as readline from 'readline';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/prisma/prisma.service';

// Node's readline has no built-in "hide input" option. This mutes the
// terminal echo of typed characters while still letting the prompt itself
// and the final newline print — a documented (if internal-API) idiom, not a
// full raw-mode solution. It only works against a real TTY: the
// `_writeToOutput` override and the raw-mode keystroke handling readline
// relies on internally never fire the same way against a piped/non-tty
// stdin, which is why this hung indefinitely when driven through
// `docker compose exec -i` or a pipe — the prompt printed, then nothing.
function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    rlAny._writeToOutput = (stringToWrite: string) => {
      if (stringToWrite === query) {
        rlAny.output.write(stringToWrite);
      }
      // Otherwise swallow the character echo entirely.
    };

    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

// Plain, visible-input prompt for a non-tty stdin (piped input, or run
// through `docker compose exec -i`/`-T`). A script that actually completes
// beats a masked prompt that hangs forever with no error — the silent
// failure this whole fix exists to close (Article IX).
//
// Deliberately *not* `rl.question()` here: against a non-tty stream, the
// whole piped input can already be sitting in the stream before the first
// `question()` call attaches its one-shot `'line'` listener, so a second
// sequential `question()` call reliably loses the second line — verified
// live, this is exactly how the original hang manifested (both prompts
// print, then nothing, because the second answer was silently dropped
// before anything ever listened for it). The async-iterator form of
// `readline.Interface` doesn't have that race: Node caches one iterator per
// interface and it drains the interface's own internal line queue, so no
// line arriving before `.next()` is called can be lost.
function promptPlainIterator(rl: readline.Interface): AsyncIterator<string> {
  return rl[Symbol.asyncIterator]();
}

async function promptPlain(iter: AsyncIterator<string>, query: string): Promise<string> {
  process.stdout.write(query);
  const { value, done } = await iter.next();
  if (done || value === undefined) {
    throw new Error('stdin cerrado antes de recibir la entrada esperada');
  }
  return value;
}

async function prompt(query: string): Promise<string> {
  if (process.stdin.isTTY) {
    return promptHidden(query);
  }

  if (!promptPlainRl) {
    promptPlainRl = readline.createInterface({ input: process.stdin, output: process.stdout });
    promptPlainIter = promptPlainIterator(promptPlainRl);
  }
  return promptPlain(promptPlainIter!, query);
}

// Reused across calls when stdin isn't a TTY, so the second prompt reads
// the next buffered line instead of losing it to a second, independent
// `rl.question()` call (see `promptPlain`'s comment).
let promptPlainRl: readline.Interface | undefined;
let promptPlainIter: AsyncIterator<string> | undefined;

async function main() {
  const username = process.argv[2];
  if (!username) {
    process.stderr.write('Uso: password:reset <username>\n');
    process.exit(1);
  }

  const prisma = new PrismaService();

  try {
    await prisma.$connect();

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      process.stderr.write(`Usuario "${username}" no encontrado\n`);
      process.exit(1);
    }

    const password = await prompt('Nueva contraseña: ');
    const confirmation = await prompt('Confirmá la contraseña: ');

    if (password !== confirmation) {
      process.stderr.write('Las contraseñas no coinciden. No se modificó nada.\n');
      process.exit(1);
    }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { username }, data: { password: hashed } });

    process.stdout.write(`Contraseña actualizada para "${username}".\n`);
  } finally {
    promptPlainRl?.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Error ejecutando password:reset:', e);
  process.exit(1);
});
