import assert from "node:assert/strict";
import test from "node:test";

import { ensureTencentHuolongTaskResource } from "../../src/app/runtime.js";
import { validateTencentHuolongTaskMaterialReferences } from
  "../../src/shared/local-materials.js";
import { createTencentHuolongTaskFixture } from "../fixtures/task-fixture.js";

test("accepts the task-provided cost analysis reference before netdisk download", () => {
  const task = createTencentHuolongTaskFixture();

  assert.doesNotThrow(() => validateTencentHuolongTaskMaterialReferences(task));
});

test("rejects a missing cost analysis commitment before netdisk download", () => {
  const task = createTencentHuolongTaskFixture();
  task.playlet.costAnalysisFiles = [];

  assert.throws(
    () => validateTencentHuolongTaskMaterialReferences(task),
    /成本配置分析（承诺函）至少需要1个，实际=0/u,
  );
});

test("does not require a task-provided non-infringement commitment", () => {
  const task = createTencentHuolongTaskFixture();

  assert.equal("nonInfringementCommitmentFiles" in task.playlet, false);
  assert.doesNotThrow(() => validateTencentHuolongTaskMaterialReferences(task));
});

test("only reports a missing task-provided cost analysis commitment", () => {
  const task = createTencentHuolongTaskFixture();
  task.playlet.costAnalysisFiles = [];

  assert.throws(
    () => validateTencentHuolongTaskMaterialReferences(task),
    (error: unknown) => error instanceof Error
      && error.message.includes("成本配置分析（承诺函）至少需要1个，实际=0")
      && !error.message.includes("不侵权承诺函"),
  );
});

test("does not start a netdisk download when contract material references are missing", async () => {
  const task = createTencentHuolongTaskFixture();
  task.playlet.costAnalysisFiles = [];
  let downloadCalls = 0;

  await assert.rejects(
    () => ensureTencentHuolongTaskResource(task, {
      localMaterialRoot: "D:\\materials",
      ensureBaiduNetdiskResource: async () => {
        downloadCalls += 1;
      },
    }),
    /成本配置分析（承诺函）至少需要1个，实际=0/u,
  );
  assert.equal(downloadCalls, 0);
});
