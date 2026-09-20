import type { BrowserContext, Page } from "playwright";
import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fetchApprovedShortplays, type ShortplayApplyRecord } from "./shortplay-manage-page.js";
import { log } from "../shared/logger.js";
import type { PinduoduoDramaRuntimeOptions } from "../shared/types.js";

const CREATOR_PUBLISH_URL = "https://mcn.pinduoduo.com/home/creator/publish";
const VIDEO_EXTENSIONS = new Set([".mp4", ".wmv", ".mov", ".avi", ".m4v"]);

function creatorPublishUrl(options: PinduoduoDramaRuntimeOptions): string {
  const uid = options.config?.creatorUid?.trim();
  if (!uid) throw new Error("Pinduoduo creator UID is required.");
  return `${CREATOR_PUBLISH_URL}?uid=${encodeURIComponent(uid)}`;
}

function openRecordPage(context: BrowserContext, record: ShortplayApplyRecord, options: PinduoduoDramaRuntimeOptions): Promise<Page> {
  return context.newPage().then(async (page) => {
    await page.goto(creatorPublishUrl(options), { waitUntil: "domcontentloaded", timeout: 60_000 });
    log(options, "info", "runtime", "opened creator video upload page", {
      title: record.title,
      uid: options.config?.creatorUid,
      url: page.url(),
    });
    return page;
  });
}

export async function runApprovedShortplayCycle(
  page: Page,
  context: BrowserContext,
  options: PinduoduoDramaRuntimeOptions,
): Promise<number> {
  const seenIds = new Set<number>();
  let pageNumber = 1;
  let opened = 0;
  while (true) {
    const records = await fetchApprovedShortplays(page, options, pageNumber);
    pageNumber += 1;
    const record = records.find((candidate) => candidate.id === undefined || !seenIds.has(candidate.id));
    if (!record) break;
    if (record.id !== undefined) seenIds.add(record.id);
    let downloadPath: string | undefined;
    if (record.demoUrl && options.ensureBaiduNetdiskResource) {
      const result = await options.ensureBaiduNetdiskResource({
        shareText: record.demoUrl,
        resourceName: record.title,
        localEpisodeVideoRoot: options.config?.video?.localEpisodeVideoRoot ?? "",
        episodeCount: record.episodeCount ?? 1,
        downloadEpisodeVideos: true,
        downloadAssetMaterials: false,
        requireAllDiscoveredAssets: false,
      });
      downloadPath = result.localPath;
    }
    const uploadPage = await openRecordPage(context, record, options);
    if (downloadPath) {
      const files = (await readdir(downloadPath, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
        .map((entry) => join(downloadPath as string, entry.name));
      if (files.length > 0) {
        await uploadPage.locator('input[data-testid="beast-core-upload-input"]').setInputFiles(files);
        await uploadPage.waitForFunction(
          () => !/上传中|处理中/.test(document.body.textContent ?? ""),
          undefined,
          { timeout: 10 * 60_000 },
        ).catch(() => undefined);
        await uploadPage.waitForTimeout(3_000);
      }
    }
    await uploadPage.close();
    opened += 1;
  }
  return opened;
}
