import { createRequire } from "node:module";

import sharp from "sharp";
import type TesseractModule from "tesseract.js";

type OwnershipProjectProofOcrKind = "jianying" | "juchuang" | "unknown";

type TesseractLanguagePackage = {
  code: string;
  gzip: boolean;
  langPath: string;
};

const minimumScreenshotAspectRatio = 1.5;
const ocrWorkerIdleTimeoutMs = 1_000;
const ocrWorkerInitializationTimeoutMs = 15_000;
const ocrRecognitionTimeoutMs = 20_000;
const ocrWorkerTerminationTimeoutMs = 2_000;
const require = createRequire(import.meta.url);
const chineseLanguage = require("@tesseract.js-data/chi_sim") as TesseractLanguagePackage;
const Tesseract = require("tesseract.js") as typeof TesseractModule;

let workerPromise: Promise<TesseractModule.Worker> | undefined;
let serializedOcrWork: Promise<void> = Promise.resolve();
let workerIdleTimer: NodeJS.Timeout | undefined;

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(errorCode)), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function terminateOcrWorker(worker: TesseractModule.Worker) {
  await withTimeout(
    Promise.resolve(worker.terminate()),
    ocrWorkerTerminationTimeoutMs,
    "OWNERSHIP_PROJECT_PROOF_OCR_WORKER_TERMINATION_TIMEOUT",
  ).catch(() => undefined);
}

function unpackedElectronPath(file: string) {
  return file.replace(/([\\/])app\.asar([\\/])/u, "$1app.asar.unpacked$2");
}

function clearWorkerIdleTimer() {
  if (!workerIdleTimer) return;
  clearTimeout(workerIdleTimer);
  workerIdleTimer = undefined;
}

function enqueueOcrWork<T>(work: () => Promise<T>): Promise<T> {
  const result = serializedOcrWork.then(work, work);
  serializedOcrWork = result.then(() => undefined, () => undefined);
  return result;
}

async function createOcrWorker() {
  const worker = await Tesseract.createWorker(
    chineseLanguage.code,
    Tesseract.OEM.LSTM_ONLY,
    {
      cacheMethod: "none",
      gzip: chineseLanguage.gzip,
      langPath: unpackedElectronPath(chineseLanguage.langPath),
      workerPath: unpackedElectronPath(
        require.resolve("tesseract.js/src/worker-script/node/index.js"),
      ),
    },
  );
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    user_defined_dpi: "300",
  });
  return worker;
}

async function getOcrWorker() {
  const pendingWorker = workerPromise ??= createOcrWorker().catch((error) => {
    workerPromise = undefined;
    throw error;
  });
  try {
    return await withTimeout(
      pendingWorker,
      ocrWorkerInitializationTimeoutMs,
      "OWNERSHIP_PROJECT_PROOF_OCR_WORKER_INITIALIZATION_TIMEOUT",
    );
  } catch (error) {
    if (workerPromise === pendingWorker) workerPromise = undefined;
    void pendingWorker.then(terminateOcrWorker).catch(() => undefined);
    throw error;
  }
}

function scheduleOcrWorkerTermination() {
  clearWorkerIdleTimer();
  workerIdleTimer = setTimeout(() => {
    workerIdleTimer = undefined;
    void enqueueOcrWork(async () => {
      const pendingWorker = workerPromise;
      workerPromise = undefined;
      if (pendingWorker) {
        await pendingWorker.then(terminateOcrWorker).catch(() => undefined);
      }
    });
  }, ocrWorkerIdleTimeoutMs);
  workerIdleTimer.unref();
}

function compactOcrText(text: string) {
  return text.replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function ownershipProjectProofOcrTextContainsJianying(text: string) {
  const compact = compactOcrText(text);
  if (/剪映|jianying|capcut/iu.test(compact)) return true;

  // The 剪映 wordmark uses a stylized font. Chinese OCR commonly reads it as
  // “勇相/勇昊/勇阵”, so also require nearby 剪映-only editor labels. This keeps
  // the decision based on OCR text without falling back to theme colors or one
  // particular screenshot hash.
  const topLeftPrefix = compact.slice(0, 24);
  const editorLabelCount = ["素材", "音频", "文本", "贴纸"]
    .filter((label) => compact.includes(label)).length;
  return /勇[相昊阵省映]/u.test(topLeftPrefix) && editorLabelCount >= 2;
}

async function prepareTopLeftOcrImage(file: string, width: number, height: number) {
  const regionWidth = Math.min(width, Math.max(240, Math.round(width * 0.18)));
  const regionHeight = Math.min(height, Math.max(90, Math.round(height * 0.12)));
  let image = sharp(file, { failOn: "error" })
    .rotate()
    .extract({ left: 0, top: 0, width: regionWidth, height: regionHeight })
    .resize({ width: 1_000 })
    .greyscale()
    .normalise()
    .sharpen();
  const stats = await image.clone().stats();
  if ((stats.channels[0]?.mean ?? 255) < 128) image = image.negate();
  return image
    .extend({ top: 30, bottom: 30, left: 30, right: 30, background: "white" })
    .png()
    .toBuffer();
}

async function recognizeTopLeftText(image: Buffer) {
  return enqueueOcrWork(async () => {
    clearWorkerIdleTimer();
    let worker: TesseractModule.Worker | undefined;
    try {
      worker = await getOcrWorker();
      const result = await withTimeout(
        worker.recognize(image),
        ocrRecognitionTimeoutMs,
        "OWNERSHIP_PROJECT_PROOF_OCR_RECOGNITION_TIMEOUT",
      );
      return result.data.text;
    } catch (error) {
      const pendingWorker = workerPromise;
      workerPromise = undefined;
      if (worker) {
        await terminateOcrWorker(worker);
      } else if (pendingWorker) {
        void pendingWorker.then(terminateOcrWorker).catch(() => undefined);
      }
      throw error;
    } finally {
      if (workerPromise) scheduleOcrWorkerTermination();
    }
  });
}

export async function classifyOwnershipProjectProofScreenshot(
  file: string,
): Promise<OwnershipProjectProofOcrKind> {
  const metadata = await sharp(file, { failOn: "error" }).metadata();
  if (!metadata.width || !metadata.height) return "unknown";

  const swapsOrientation = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
  const width = swapsOrientation ? metadata.height : metadata.width;
  const height = swapsOrientation ? metadata.width : metadata.height;
  if (!width || !height || width / height < minimumScreenshotAspectRatio) return "unknown";

  const image = await prepareTopLeftOcrImage(file, width, height);
  const text = await recognizeTopLeftText(image).catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[ownership-project-proof-ocr-failed] 无法识别权属工程截图左上角：${file}；${detail}`,
    );
  });
  return ownershipProjectProofOcrTextContainsJianying(text) ? "jianying" : "juchuang";
}
