import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TencentHuolongRuntimeOptions } from "../shared/types.js";

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createTestPdf(documentType: string) {
  const lines = [
    "AUTOMATION TEST SAMPLE",
    "Not a legal document. Do not submit for production review.",
    `Document type: ${documentType}`,
    "Purpose: validate file selection and upload controls.",
  ];
  const commands = lines.map((line, index) => (
    `${index === 0 ? "/F1 18 Tf" : "/F1 11 Tf"} 72 ${760 - index * 34} Td (${escapePdfText(line)}) Tj`
  )).join("\n");
  const stream = `BT\n${commands}\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
  ];

  let pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

export async function ensureLocalTencentHuolongMockFiles(options: TencentHuolongRuntimeOptions) {
  const root = path.join(
    options.assetDownloadDir?.trim() || path.join(tmpdir(), "tencent-huolong-drama"),
    "mock-documents",
  );
  await mkdir(root, { recursive: true });
  const costAnalysisFile = path.join(root, "成本配置分析-自动化测试.pdf");
  await writeFile(costAnalysisFile, createTestPdf("Cost Analysis Commitment (test placeholder)"));
  return { costAnalysisFile };
}
