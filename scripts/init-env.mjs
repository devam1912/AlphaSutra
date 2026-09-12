import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

// Exclusive creation prevents accidentally replacing an operator's credentials.
const template = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
const content = template.replace(
  /^ML_SERVICE_TOKEN=.*$/m,
  `ML_SERVICE_TOKEN=${randomBytes(32).toString('hex')}`,
);
try {
  await writeFile(new URL('../.env', import.meta.url), content, { flag: 'wx', mode: 0o600 });
  process.stdout.write(
    'Created .env with a private random service token. No provider keys are configured.\n',
  );
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  process.stdout.write('.env already exists and was preserved.\n');
}
