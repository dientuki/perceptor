import * as readline from 'readline';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SHARED_PASSWORD_MIN_LENGTH,
  isSharedPasswordLongEnough,
  setProwlarrLogin,
  setQbittorrentLogin,
} from '../src/shared-login/shared-login';

function promptHidden(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WritableStream };
    rlAny._writeToOutput = (stringToWrite: string) => {
      if (stringToWrite === query) {
        rlAny.output.write(stringToWrite);
      }
    };

    rl.question(query, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

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

    if (password.length === 0) {
      process.stderr.write('La contraseña no puede estar vacía. No se modificó nada.\n');
      process.exit(1);
    }

    const isSharedAdmin = username === process.env.ADMIN_USER;
    if (isSharedAdmin && !isSharedPasswordLongEnough(password)) {
      process.stderr.write(
        `La contraseña del administrador debe tener al menos ${SHARED_PASSWORD_MIN_LENGTH} caracteres (mínimo de qBittorrent). No se modificó nada.\n`,
      );
      process.exit(1);
    }

    const hashed = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { username }, data: { password: hashed } });

    process.stdout.write(`App: contraseña actualizada para "${username}".\n`);

    if (isSharedAdmin) {
      const rows = await prisma.setting.findMany();
      const config = rows.reduce<Record<string, string>>((map, row) => {
        map[row.key] = row.value;
        return map;
      }, {});

      const labels = { qbittorrent: 'qBittorrent', prowlarr: 'Prowlarr' };
      const results = [
        await setQbittorrentLogin(config, username, password),
        await setProwlarrLogin(config, username, password),
      ];

      for (const result of results) {
        process.stdout.write(
          result.ok
            ? `${labels[result.target]}: actualizado\n`
            : `${labels[result.target]}: NO actualizado (${result.reason})\n`,
        );
      }

      if (results.some((result) => !result.ok)) {
        process.stdout.write('Podés volver a ejecutar este comando cuando el servicio vuelva a estar disponible.\n');
        process.exitCode = 1;
      }
    }
  } finally {
    promptPlainRl?.close();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('Error ejecutando password:reset:', e);
  process.exit(1);
});
