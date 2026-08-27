import { app } from "electron";
import console from "node:console";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tsImport } from "tsx/esm/api";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function configuredUserDataDir() {
  const appDataDir = app.getPath("appData");
  const candidates = ["drama-post-auto", "AutoDrama"]
    .map((name) => path.join(appDataDir, name));
  return candidates.find((candidate) =>
    existsSync(path.join(candidate, "global-app-config.json"))) ?? candidates[0];
}

function preparePreviewUserDataDir() {
  const configuredDir = configuredUserDataDir();
  const previewDir = path.join(app.getPath("appData"), "drama-post-auto-ai-preview");
  const sourceConfig = path.join(configuredDir, "global-app-config.json");
  if (!existsSync(sourceConfig)) {
    throw new Error(`GLOBAL_AI_CONFIG_FILE_NOT_FOUND: ${sourceConfig}`);
  }
  mkdirSync(previewDir, { recursive: true });
  copyFileSync(sourceConfig, path.join(previewDir, "global-app-config.json"));
  const sourceLocalState = path.join(configuredDir, "Local State");
  if (existsSync(sourceLocalState)) {
    copyFileSync(sourceLocalState, path.join(previewDir, "Local State"));
  }
  return previewDir;
}

function titleFromPosterPath(inputFile) {
  return path.basename(inputFile, path.extname(inputFile))
    .replace(/\s*-\s*(?:海报封面|海报|封面)\s*$/u, "")
    .trim();
}

export async function previewKuaishouAdCover(
  inputFile,
  requestedOutputDir,
  options = {},
) {
  const sourceFile = path.resolve(inputFile);
  const sourceStat = await stat(sourceFile).catch(() => undefined);
  if (!sourceStat?.isFile() || sourceStat.size <= 0) {
    throw new Error(`KUAISHOU_AD_COVER_PREVIEW_INPUT_INVALID: ${sourceFile}`);
  }

  const outputDir = requestedOutputDir
    ? path.resolve(requestedOutputDir)
    : path.join(path.dirname(sourceFile), "AI裁剪预览");
  await mkdir(outputDir, { recursive: true });
  const diagnosticFile = path.join(outputDir, "快手广告AI封面测试.log");
  await writeFile(diagnosticFile, `[${new Date().toISOString()}] 测试开始：${sourceFile}\n`);
  const log = (message) => {
    appendFileSync(diagnosticFile, `[${new Date().toISOString()}] ${message}\n`);
    console.log(message);
  };
  const sourceBaseName = path.basename(sourceFile, path.extname(sourceFile));
  const previewFile = path.join(outputDir, `${sourceBaseName} - 快手广告AI封面.jpg`);
  const analysisFile = path.join(outputDir, `${sourceBaseName} - 快手广告AI封面.json`);

  try {
    const [{ createOpenAiCompatibleClient }, automationModule, mediaAssetsModule] = await Promise.all([
      import("@drama/ai"),
      import("@drama/kuaishou-drama-automation"),
      import("@drama/drama-media-assets"),
    ]);
    if (options.reuseAnalysis && existsSync(analysisFile)) {
      log(`复用已有 AI 坐标重新裁剪：${analysisFile}`);
      const previousMetadata = JSON.parse(await readFile(analysisFile, "utf8"));
      const parsedAnalysis = automationModule.kuaishouAdCoverAnalysisSchema.parse(
        previousMetadata.analysis,
      );
      const dimensions = await mediaAssetsModule.readImageDimensions(sourceFile);
      const crop = automationModule.calculateKuaishouAdCoverCrop(parsedAnalysis, dimensions);
      await mediaAssetsModule.prepareExtractedImageVariant({
        inputFile: sourceFile,
        outputFile: previewFile,
        crop,
        width: 900,
        height: 1200,
        jpegQuality: 92,
        maxFileBytes: 1_900_000,
        onLog: log,
      });
      await writeFile(analysisFile, JSON.stringify({
        ...previousMetadata,
        promptVersion: "kuaishou-ad-cover-v3-recrop",
        sourceDimensions: dimensions,
        crop,
        updatedAt: new Date().toISOString(),
      }, null, 2));
      log(`复用坐标测试完成：${previewFile}`);
      return {
        inputFile: sourceFile,
        outputFile: previewFile,
        analysisFile,
        diagnosticFile,
        model: previousMetadata.model,
      };
    }

    log(`读取项目全局 AI 配置：userData=${app.getPath("userData")}`);
    const globalConfigModule = await tsImport(
      "../electron/global-app-config.ts",
      { parentURL: import.meta.url },
    );
    const clientOptions = globalConfigModule.getConfiguredAiClientOptions();
    log(`开始模型分析：model=${clientOptions.model} baseURL=${clientOptions.baseURL}`);
    const aiClient = createOpenAiCompatibleClient({
      ...clientOptions,
      maxRetries: 0,
      timeoutMs: 180_000,
    });
    const generatedFile = await automationModule.prepareKuaishouAdUnlockCover({
      title: titleFromPosterPath(sourceFile),
      localCoverFile: sourceFile,
    }, {
      aiClient,
      aiModelId: clientOptions.model,
      adCoverAiAnalysisAttempts: 1,
      assetDownloadDir: outputDir,
      onLog: log,
    });

    const generatedAnalysisFile = generatedFile.replace(/\.jpg$/iu, ".json");
    await copyFile(generatedFile, previewFile);
    if (existsSync(generatedAnalysisFile)) {
      await copyFile(generatedAnalysisFile, analysisFile);
    }
    log(`测试完成：${previewFile}`);

    return {
      inputFile: sourceFile,
      outputFile: previewFile,
      analysisFile: existsSync(analysisFile) ? analysisFile : undefined,
      diagnosticFile,
      model: clientOptions.model,
    };
  } catch (error) {
    log(`测试失败：${errorMessage(error)}`);
    throw error;
  }
}

app.setName("drama-post-auto-ai-preview");
app.setPath("userData", preparePreviewUserDataDir());

async function runPreviewFromArguments() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  const positionalArgs = args.filter((argument) => !argument.startsWith("--"));
  const inputFile = positionalArgs[0];
  if (!inputFile) {
    throw new Error(
      "请提供海报文件路径：pnpm kuaishou-drama:preview-ad-cover -- \"D:\\path\\poster.jpg\"",
    );
  }
  const result = await previewKuaishouAdCover(inputFile, positionalArgs[1], {
    reuseAnalysis: args.includes("--reuse-analysis"),
  });
  console.log(`[kuaishou-ad-cover-preview] 完成：${JSON.stringify(result)}`);
}

app.whenReady()
  .then(runPreviewFromArguments)
  .catch((error) => {
    console.error(`[kuaishou-ad-cover-preview] 失败：${errorMessage(error)}`);
    process.exitCode = 1;
  })
  .finally(() => app.exit(process.exitCode ?? 0));
