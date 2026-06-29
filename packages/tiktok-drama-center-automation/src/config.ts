import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { multistream, pino } from 'pino';
import { z } from 'zod';

const configSchema = z.object({
  logFile: z.string().min(1).default(path.resolve('logs/app.log')),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  loginUrl: z.string().url().default('https://www.tiktokdramacenter.com/login'),
  draftUrl: z.string().url().default('https://www.tiktokdramacenter.com/series/draft'),
  userDataDir: z.string().min(1).default(path.resolve('.auth/tiktok')),
  videoDir: z.string().min(1).default(path.resolve('videos')),
  schemeApi: z.string().url().optional(),
  schemeFile: z.string().min(1).default('scheme.local.json'),
  tempDir: z.string().min(1).default(path.resolve('.tmp')),
  postTaskWatchMs: z.number().nonnegative().default(5_000),
  submit: z.boolean().default(false),
  keepBrowserOpen: z.boolean().default(true),
  headless: z.boolean().default(false)
});

export type TiktokDramaCenterRuntimeSettings = z.input<typeof configSchema>;
export type TiktokDramaCenterConfig = z.infer<typeof configSchema>;
type RuntimeLogger = {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
};

export let config: TiktokDramaCenterConfig = configSchema.parse({});
export let logger: RuntimeLogger = pino({ level: config.logLevel }, process.stdout);

export function configureTiktokDramaCenterRuntimeSettings(
  settings: Partial<TiktokDramaCenterRuntimeSettings> = {}
) {
  config = configSchema.parse(settings);
  logger = createLogger(config);
  return config;
}

function createLogger(nextConfig: TiktokDramaCenterConfig): RuntimeLogger {
  mkdirSync(path.dirname(nextConfig.logFile), { recursive: true });

  return pino(
    { level: nextConfig.logLevel },
    multistream([
      { stream: process.stdout },
      { stream: createWriteStream(nextConfig.logFile, { flags: 'a' }) },
    ])
  );
}
