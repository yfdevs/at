import assert from "node:assert/strict";
import test from "node:test";

import { collectShortDramaCertificationFiles } from "../../src/automation/publish-runner.js";

test("uploads every Baidu contract file to short drama certification", () => {
  const files = collectShortDramaCertificationFiles({
    qualification: { proofFiles: [] },
    copyright: {
      productionProofFiles: ["contract.pdf"],
      licenseProofFiles: ["authorization.pdf"],
    },
    productionCost: { proofFiles: ["cost-report.pdf"] },
    commitmentFiles: ["commitment.pdf"],
  });

  assert.deepEqual(files, [
    "contract.pdf",
    "authorization.pdf",
    "cost-report.pdf",
    "commitment.pdf",
  ]);
});

test("keeps all files per type and removes duplicate references", () => {
  const files = collectShortDramaCertificationFiles({
    qualification: { proofFiles: ["qualification.pdf"] },
    copyright: {
      productionProofFiles: ["contract-a.pdf", "contract-b.pdf"],
      licenseProofFiles: ["authorization.pdf"],
    },
    productionCost: { proofFiles: ["cost-report.pdf"] },
    commitmentFiles: ["commitment.pdf", "contract-a.pdf"],
  });

  assert.deepEqual(files, [
    "qualification.pdf",
    "contract-a.pdf",
    "contract-b.pdf",
    "authorization.pdf",
    "cost-report.pdf",
    "commitment.pdf",
  ]);
});
