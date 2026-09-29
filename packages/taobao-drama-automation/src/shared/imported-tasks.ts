import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { TAOBAO_DRAMA_MAX_EPISODES_PER_TASK } from "./constants.js";
import type { TaobaoBatchUploadTask } from "./types.js";

type CellValue = string | number | boolean | Date | null | undefined;

export type TaobaoWorkbookIssue = {
  sheet: string;
  row: number;
  message: string;
};

export type TaobaoWorkbookImportResult = {
  tasks: TaobaoBatchUploadTask[];
  issues: TaobaoWorkbookIssue[];
};

const headerAliases = {
  title: ["剧名", "短剧名称", "剧目名称", "标题"],
  link: ["网盘链接", "百度网盘链接", "百度云链接", "资源链接"],
  episodes: ["集数", "总集数", "剧集数"],
} as const;

function text(value: CellValue) {
  if (value == null) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizedHeader(value: CellValue) {
  return text(value).replace(/[\s：:()（）]/g, "");
}

export function hasBaiduExtractionCode(value: string) {
  try {
    const link = value.match(/https?:\/\/pan\.baidu\.com\/s\/[^\s"'<>]+/i)?.[0];
    if (!link) return false;
    const url = new URL(link);
    return Boolean(
      url.searchParams.get("pwd")
      || value.match(/(?:提取码|密码|pwd)[:：\s]*([a-zA-Z0-9]{4})/i)?.[1],
    );
  } catch {
    return false;
  }
}

function findColumn(row: CellValue[], aliases: readonly string[]) {
  return row.findIndex((value) => aliases.includes(normalizedHeader(value)));
}

function taskId(sourceFileName: string, sheet: string, row: number, title: string) {
  return `${sourceFileName}:${sheet}:${row}:${title}`;
}

export function parseTaobaoWorkbookRows(
  sourceFileName: string,
  sheets: Array<{ name: string; rows: CellValue[][] }>,
): TaobaoWorkbookImportResult {
  const tasks: TaobaoBatchUploadTask[] = [];
  const issues: TaobaoWorkbookIssue[] = [];

  for (const sheet of sheets) {
    const headerIndex = sheet.rows.slice(0, 20).findIndex((row) =>
      findColumn(row, headerAliases.title) >= 0 &&
      findColumn(row, headerAliases.link) >= 0 &&
      findColumn(row, headerAliases.episodes) >= 0
    );
    if (headerIndex < 0) {
      if (sheet.rows.some((row) => row.some((value) => text(value)))) {
        issues.push({ sheet: sheet.name, row: 1, message: "未找到“剧名、网盘链接、集数”表头" });
      }
      continue;
    }

    const headers = sheet.rows[headerIndex] ?? [];
    const titleColumn = findColumn(headers, headerAliases.title);
    const linkColumn = findColumn(headers, headerAliases.link);
    const episodesColumn = findColumn(headers, headerAliases.episodes);
    for (let index = headerIndex + 1; index < sheet.rows.length; index += 1) {
      const row = sheet.rows[index] ?? [];
      if (!row.some((value) => text(value))) continue;
      const rowNumber = index + 1;
      const originalTitle = text(row[titleColumn]);
      const baiduPanResourceLink = text(row[linkColumn]);
      const episodeText = text(row[episodesColumn]);
      const episodeCount = Number(episodeText);
      const rowIssues: string[] = [];
      if (!originalTitle) rowIssues.push("剧名为空");
      if (!baiduPanResourceLink) rowIssues.push("网盘链接为空");
      else if (!/pan\.baidu\.com/i.test(baiduPanResourceLink)) rowIssues.push("网盘链接不是百度网盘链接");
      else if (!hasBaiduExtractionCode(baiduPanResourceLink)) {
        rowIssues.push("百度网盘链接缺少4位提取码（链接需包含 ?pwd=xxxx）");
      }
      if (
        !Number.isInteger(episodeCount) ||
        episodeCount < 1 ||
        episodeCount > TAOBAO_DRAMA_MAX_EPISODES_PER_TASK
      ) {
        rowIssues.push(`集数必须是 1-${TAOBAO_DRAMA_MAX_EPISODES_PER_TASK} 的整数`);
      }
      if (rowIssues.length) {
        issues.push({ sheet: sheet.name, row: rowNumber, message: rowIssues.join("；") });
        continue;
      }
      tasks.push({
        id: taskId(sourceFileName, sheet.name, rowNumber, originalTitle),
        originalTitle,
        baiduPanResourceLink,
        episodeCount,
        sourceFileName,
        sourceSheet: sheet.name,
        sourceRow: rowNumber,
      });
    }
  }
  return { tasks, issues };
}

export async function readTaobaoBatchUploadWorkbook(
  filePath: string,
): Promise<TaobaoWorkbookImportResult> {
  const workbook = XLSX.read(await readFile(filePath), { type: "buffer", cellDates: true });
  const sourceFileName = basename(filePath);
  return parseTaobaoWorkbookRows(
    sourceFileName,
    workbook.SheetNames.map((name) => ({
      name,
      rows: worksheetRows(workbook.Sheets[name]!),
    })),
  );
}

function worksheetRows(sheet: XLSX.WorkSheet): CellValue[][] {
  if (!sheet["!ref"]) return [];
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const rows: CellValue[][] = [];
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row: CellValue[] = [];
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      const hyperlink = cell?.l?.Target?.trim();
      row.push(hyperlink || cell?.w || cell?.v as CellValue || "");
    }
    rows.push(row);
  }
  return rows;
}
