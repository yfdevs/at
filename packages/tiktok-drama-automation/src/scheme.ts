import { readFile } from 'node:fs/promises';
import type { BrowserContext } from 'playwright';
import { z } from 'zod';
import { config, logger } from './config.js';

const pricePerEpisodeSchema = z.union([z.number().nonnegative(), z.string().min(1)]).optional();
const publishModeSchema = z.enum(['过审后自动发布', '手动发布', '定时发布', 'auto', 'manual', 'scheduled']).default('手动发布');

export const schemaObject = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(35),
  description: z.string().trim().min(1).max(1500),
  episodeCount: z.number().int().positive().max(120),
  coverFile: z.string().trim().min(1).max(2048),
  baiduPanResourceLink: z.string().trim().min(1).max(2048).optional(),
  contractText: z.string().trim().min(1).optional(),
  contractId: z.string().trim().min(1).optional(),
  targetAudience: z.enum(['女性', '男性']),
  themes: z.array(z.string().trim().min(1)).default([]),
  sourceLanguage: z.enum(['英语', '印尼语', '葡语', '日语', '泰语', '西语', '韩语', '土耳其语', '中文', '印地语']),
  isAiDrama: z.enum(['是', '否']).default('否'),
  publishAccounts: z.array(z.string().trim().min(1)).optional(),
  publishMode: publishModeSchema,
  scheduledAt: z.string().trim().min(1).optional(),
  autoMountAnchor: z.boolean().default(true),
  hostingMode: z.boolean().default(true),
  freePreviewEpisodes: z.number().int().nonnegative().optional(),
  paidFreePreviewEpisodes: z.number().int().nonnegative().optional(),
  pricePerEpisode: pricePerEpisodeSchema,
  purchaseMode: z.enum(['episode', 'full']).optional(),
  actors: z.array(z.string().trim().min(1)).max(5).default([]),
  submit: z.boolean().default(false)
}).superRefine((scheme, ctx) => {
  if ((scheme.publishMode === '定时发布' || scheme.publishMode === 'scheduled') && !scheme.scheduledAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['scheduledAt'],
      message: 'scheduledAt is required when publishMode=定时发布'
    });
  }
}).transform(({ contractId, contractText, pricePerEpisode, publishMode, ...scheme }) => ({
  ...scheme,
  contractText: contractText ?? contractId,
  publishMode: normalizePublishMode(publishMode),
  pricePerEpisode: normalizePricePerEpisode(pricePerEpisode)
}));

export type Scheme = z.infer<typeof schemaObject>;

export async function loadScheme(
  context: BrowserContext,
  schemeFile = process.argv[2] ?? config.schemeFile
): Promise<Scheme> {
  if (config.schemeApi) {
    logger.info({ url: config.schemeApi }, 'fetching scheme');
    const res = await context.request.get(config.schemeApi);
    if (!res.ok()) throw new Error(`failed to fetch scheme: ${res.status()} ${res.statusText()}`);
    return schemaObject.parse(await res.json());
  }

  return schemaObject.parse(JSON.parse(await readFile(schemeFile, 'utf8')));
}

function normalizePricePerEpisode(value: z.infer<typeof pricePerEpisodeSchema>) {
  if (value == null) return undefined;
  if (typeof value === 'number') return `$${value.toFixed(2)}`;

  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return `$${Number(text).toFixed(2)}`;
  return text;
}

function normalizePublishMode(value: z.infer<typeof publishModeSchema>) {
  if (value === 'auto') return '过审后自动发布';
  if (value === 'scheduled') return '定时发布';
  if (value === 'manual') return '手动发布';
  return value;
}
