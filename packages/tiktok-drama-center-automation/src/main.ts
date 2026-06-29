import { mkdir } from 'node:fs/promises';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { config, configureTiktokDramaCenterRuntimeSettings, logger } from './config.js';
import { fillDraft, waitForDraftPage } from './draft-form.js';
import { matchVideos, resolveCoverFile } from './media.js';
import { loadScheme } from './scheme.js';

async function main() {
  configureTiktokDramaCenterRuntimeSettings();
  const context = await launchContext();
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(config.draftUrl, { waitUntil: 'domcontentloaded' });
    await waitForDraftPage(page);

    logger.info('draft ready; loading scheme');
    const scheme = await loadScheme(context);
    const videos = await matchVideos(config.videoDir, scheme.title, scheme.episodeCount);
    const coverFile = await resolveCoverFile(scheme.coverFile, scheme.id);

    logger.info({ taskId: scheme.id, title: scheme.title, videos: videos.length }, 'starting task');
    const stopWatchingToast = new AbortController();
    try {
      await Promise.race([
        runTask(page, scheme, coverFile, videos),
        watchToast(page, stopWatchingToast.signal)
      ]);
    } finally {
      stopWatchingToast.abort();
    }
    await keepBrowserOpen();
  } catch (error) {
    logger.error({ err: error }, 'task failed');
    await keepBrowserOpen();
    await context.close();
    process.exitCode = 1;
  }
}

async function runTask(page: Page, scheme: Awaited<ReturnType<typeof loadScheme>>, coverFile: string, videos: Awaited<ReturnType<typeof matchVideos>>) {
  await fillDraft(page, scheme, coverFile, videos);

  // ponytail: submission disabled while testing; re-enable this click after upload flow is verified.
  // if (scheme.submit || config.submit) await page.getByRole('button', { name: '提交' }).click();
  logger.info({ taskId: scheme.id }, 'dry run finished; submit click is disabled while testing');
  await page.waitForTimeout(config.postTaskWatchMs);
}

async function keepBrowserOpen() {
  if (!config.keepBrowserOpen) return;
  logger.warn('browser kept open; press Ctrl+C to exit');
  await new Promise(() => {});
}

async function watchToast(page: Page, signal: AbortSignal) {
  const portal = page.locator('[data-tux-toast-portal]').last();
  await Promise.race([
    portal.waitFor({ state: 'attached', timeout: 0 }),
    new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
  ]);
  if (signal.aborted) return await new Promise<never>(() => {});

  const message = (await portal.innerText()).replace(/\s*复制\s*$/, '').trim();
  logger.error({ toast: message }, 'toast error');
  throw new Error(`toast error: ${message}`);
}

async function launchContext(): Promise<BrowserContext> {
  await mkdir(config.userDataDir, { recursive: true });
  logger.info({ userDataDir: config.userDataDir }, 'using persistent browser profile');
  return chromium.launchPersistentContext(config.userDataDir, {
    headless: config.headless,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    timeout: 0
  });
}

main().catch(error => {
  logger.error({ err: error }, 'task failed before browser was ready');
  process.exitCode = 1;
});
