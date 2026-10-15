import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
  realpath,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { temporaryArtifactServer } from './static-files';
import { assertProjectFiles } from './project-files';
import type { ValidationReport } from '../shared/types';

const require = createRequire(import.meta.url);
export async function artifactHash(dir: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(folder: string) {
    for (const file of (await readdir(folder, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const target = path.join(folder, file.name);
      if (file.isDirectory()) await visit(target);
      else {
        hash.update(path.relative(dir, target));
        hash.update(await readFile(target));
      }
    }
  }
  await visit(dir);
  return hash.digest('hex');
}
export async function buildGame(
  workspace: string,
  output: string,
): Promise<void> {
  await assertProjectFiles(workspace);
  await mkdir(output, { recursive: true });
  const root = await realpath(workspace);
  const phaser = require.resolve('phaser/dist/phaser.js');
  await build({
    absWorkingDir: workspace,
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: path.join(output, 'game.js'),
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    logLevel: 'silent',
    sourcemap: false,
    loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl' },
    plugins: [
      {
        name: 'project-imports-only',
        setup(context) {
          context.onLoad({ filter: /.*/ }, async (args) => {
            if (args.path === phaser) return;
            const target = await realpath(args.path);
            if (!target.startsWith(`${root}${path.sep}`))
              return { errors: [{ text: '禁止读取项目外的文件。' }] };
            return;
          });
          context.onResolve({ filter: /.*/ }, async (args) => {
            if (args.path === 'phaser') return { path: phaser };
            if (args.importer === phaser) return;
            if (args.kind !== 'entry-point' && !args.path.startsWith('.'))
              return {
                errors: [
                  {
                    text: `不支持依赖 ${args.path}；首版仅提供 Phaser 与项目内模块。`,
                  },
                ],
              };
            const target = path.resolve(
              args.resolveDir || workspace,
              args.path,
            );
            if (!target.startsWith(`${root}${path.sep}`))
              return { errors: [{ text: '导入必须位于当前项目内。' }] };
            return;
          });
        },
      },
    ],
  });
  await writeFile(
    path.join(output, 'index.html'),
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenGame</title><link rel="stylesheet" href="./base.css">${existsSync(path.join(output, 'game.css')) ? '<link rel="stylesheet" href="./game.css">' : ''}</head><body><div id="game-root"></div><script src="./game.js"></script></body></html>`,
  );
  await writeFile(
    path.join(output, 'base.css'),
    'html,body{margin:0;min-height:100%;background:#111629;color:#f4f5ff;font:15px system-ui}*{box-sizing:border-box}#game-root{min-height:100vh;width:100%;overflow:hidden}canvas{display:block;max-width:100%;margin:auto}button{font:inherit;cursor:pointer}button:focus-visible{outline:3px solid #b2a8ff;outline-offset:3px}',
  );
}
export function browserOptions() {
  const chrome =
    process.env.OPENGAME_CHROME_PATH ||
    (process.platform === 'darwin' &&
    existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined);
  return { headless: true, executablePath: chrome || undefined };
}
export async function validateGame(
  output: string,
  signal?: AbortSignal,
): Promise<ValidationReport> {
  signal?.throwIfAborted();
  const server = await temporaryArtifactServer(output);
  let browser: Browser | undefined;
  const report: ValidationReport = {
    build: true,
    browser: false,
    start: false,
    restart: false,
    errors: [],
    checkedAt: new Date().toISOString(),
  };
  const abort = () => {
    void browser?.close();
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    browser = await chromium.launch(browserOptions());
    signal?.throwIfAborted();
    const page = await browser.newPage({
      viewport: { width: 960, height: 660 },
    });
    page.setDefaultTimeout(12000);
    page.on('pageerror', (error) =>
      report.errors.push(error.message.slice(0, 400)),
    );
    page.on('response', (response) => {
      if (response.status() >= 400)
        report.errors.push(`资源请求失败 ${response.status()}`);
    });
    await page.goto(server.url, { waitUntil: 'load', timeout: 15000 });
    await page.locator('#start-game').click();
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    report.start = true;
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    await page.locator('#restart-game').click();
    await page.locator('canvas').first().waitFor({ state: 'visible' });
    report.restart = true;
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(output, 'preview.png') });
    report.browser = report.errors.length === 0;
    if (!report.browser) throw new Error(report.errors.join('\n'));
    return report;
  } catch (error) {
    throw new Error(
      `浏览器检查未通过：${error instanceof Error ? error.message.slice(0, 900) : String(error)}`,
    );
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      await browser?.close();
    } finally {
      await server.close();
    }
  }
}
