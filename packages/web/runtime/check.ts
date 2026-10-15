import { readdir } from 'node:fs/promises';
import { buildGame, validateGame } from '../src/server/build-game';

try {
  await buildGame('/input/project', '/output');
  const validation = await validateGame('/output');
  console.log(
    'OPENGAME_RESULT=' +
      JSON.stringify({ ok: true, validation, files: await readdir('/output') }),
  );
} catch (error) {
  console.log(
    'OPENGAME_RESULT=' +
      JSON.stringify({
        ok: false,
        error:
          error instanceof Error
            ? error.message.slice(0, 1500)
            : '检查未完成。',
      }),
  );
}
