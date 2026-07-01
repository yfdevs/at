import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import {
  config,
  configureTiktokDramaCenterRuntimeSettings,
  logger,
} from '../config.js';
import { fillDraft, waitForDraftPage } from '../draft-form.js';
import { matchVideos, resolveCoverFile } from '../media.js';
import { loadScheme } from '../scheme.js';

export type TiktokDramaCenterLoginState = 'login-required' | 'logged-in' | 'unknown';

export type TiktokDramaCenterRuntimeStatus = {
  platform: 'tiktok-drama';
  running: boolean;
  loginState: TiktokDramaCenterLoginState;
  activeUrl?: string;
  userDataDir: string;
};

export type TiktokDramaCenterRuntime = {
  getStatus: () => TiktokDramaCenterRuntimeStatus;
  stop: () => Promise<void>;
};

type TiktokDramaCenterRuntimeConfig = {
  browser?: {
    headless?: boolean;
    slowMo?: number;
  };
  draftUrl?: string;
  headless?: boolean;
  keepBrowserOpen?: boolean;
  logFile?: string;
  logLevel?: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  loginUrl?: string;
  postTaskWatchMs?: number;
  schemeApi?: string;
  schemeFile?: string;
  submit?: boolean;
  tempDir?: string;
  userDataDir?: string;
  videoDir?: string;
};

export type TiktokDramaCenterRuntimeOptions = {
  config?: TiktokDramaCenterRuntimeConfig;
  credentialStatePath?: string;
  onLog?: (message: string) => void;
  userDataDir?: string;
};

export async function startTiktokDramaCenterRuntime(
  options: TiktokDramaCenterRuntimeOptions = {}
): Promise<TiktokDramaCenterRuntime> {
  if (!options.userDataDir) {
    throw new Error('TikTok userDataDir is required.');
  }

  const userDataDir = options.userDataDir;
  const runDataDir = runDataDirFromUserDataDir(userDataDir);
  const { browser, ...runtimeSettings } = options.config ?? {};
  const slowMo = browser?.slowMo ?? 20;
  let running = true;
  let page: Page | null = null;
  let context: BrowserContext | null = null;

  configureTiktokDramaCenterRuntimeSettings({
    ...runtimeSettings,
    userDataDir,
    headless: browser?.headless ?? runtimeSettings.headless ?? false,
    logFile: runtimeSettings.logFile ?? path.join(runDataDir, 'logs', 'app.log'),
    schemeFile: runtimeSettings.schemeFile ?? path.join(runDataDir, 'scheme.local.json'),
    tempDir: runtimeSettings.tempDir ?? path.join(runDataDir, 'tmp'),
    videoDir: runtimeSettings.videoDir ?? path.join(runDataDir, 'videos'),
  });

  await mkdir(userDataDir, { recursive: true });
  log(options, '[tiktok-drama] starting browser');
  context = await chromium.launchPersistentContext(userDataDir, {
    acceptDownloads: true,
    headless: config.headless,
    slowMo,
    timeout: 0,
    viewport: { width: 1440, height: 1000 },
  });
  context.on('close', () => {
    running = false;
  });

  page = context.pages()[0] ?? await context.newPage();
  void runDraftTask(context, page, options).catch(error => {
    log(options, `[tiktok-drama] task failed: ${errorMessage(error)}`);
    logger.error({ err: error }, 'task failed');
  });

  return {
    getStatus(): TiktokDramaCenterRuntimeStatus {
      const activeUrl = page?.url();
      return {
        platform: 'tiktok-drama',
        running,
        loginState: loginStateFromUrl(activeUrl),
        activeUrl,
        userDataDir,
      };
    },
    async stop() {
      if (context && options.credentialStatePath) {
        await mkdir(path.dirname(options.credentialStatePath), { recursive: true });
        await context.storageState({ path: options.credentialStatePath }).catch(() => undefined);
      }
      running = false;
      await context?.close();
      log(options, '[tiktok-drama] runtime stopped');
    },
  };
}

async function runDraftTask(
  context: BrowserContext,
  page: Page,
  options: TiktokDramaCenterRuntimeOptions
) {
  await page.goto(config.draftUrl, { waitUntil: 'domcontentloaded' });
  await waitForDraftPage(page);

  logger.info('draft ready; loading scheme');
  const scheme = await loadScheme(context, config.schemeFile);
  const videos = await matchVideos(config.videoDir, scheme.title, scheme.episodeCount);
  const coverFile = await resolveCoverFile(scheme.coverFile, scheme.id);

  logger.info({ taskId: scheme.id, title: scheme.title, videos: videos.length }, 'starting task');
  const stopWatchingToast = new AbortController();
  try {
    await Promise.race([
      fillDraftAndWait(page, scheme, coverFile, videos),
      watchToast(page, stopWatchingToast.signal),
    ]);
  } finally {
    stopWatchingToast.abort();
  }

  log(options, `[tiktok-drama] task finished: ${scheme.id}`);
}

async function fillDraftAndWait(
  page: Page,
  scheme: Awaited<ReturnType<typeof loadScheme>>,
  coverFile: string,
  videos: Awaited<ReturnType<typeof matchVideos>>
) {
  await fillDraft(page, scheme, coverFile, videos);

  // ponytail: submit stays disabled until the upload flow has been verified with real files.
  logger.info({ taskId: scheme.id }, 'dry run finished; submit click is disabled while testing');
  await page.waitForTimeout(config.postTaskWatchMs);
}

async function watchToast(page: Page, signal: AbortSignal) {
  const portal = page.locator('[data-tux-toast-portal]').last();
  await Promise.race([
    portal.waitFor({ state: 'attached', timeout: 0 }),
    new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })),
  ]);
  if (signal.aborted) return await new Promise<never>(() => {});

  const message = (await portal.innerText()).replace(/\s*复制\s*$/, '').trim();
  logger.error({ toast: message }, 'toast error');
  throw new Error(`toast error: ${message}`);
}

function loginStateFromUrl(url: string | undefined): TiktokDramaCenterLoginState {
  if (!url || url === 'about:blank') return 'unknown';

  try {
    return new URL(url).pathname === new URL(config.loginUrl).pathname
      ? 'login-required'
      : 'logged-in';
  } catch {
    return url.includes('login') ? 'login-required' : 'logged-in';
  }
}

function runDataDirFromUserDataDir(userDataDir: string) {
  const parent = path.dirname(userDataDir);
  return path.basename(parent) === 'auth' ? path.dirname(parent) : parent;
}

function log(options: TiktokDramaCenterRuntimeOptions, message: string) {
  options.onLog?.(message);
  logger.info(message);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
