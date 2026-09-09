import assert from "node:assert/strict";
import test from "node:test";

import { getLocalTencentHuolongDramaTask } from "../../src/api/task.js";
import { ensureTencentHuolongTaskResource } from "../../src/app/runtime.js";
import { validateTencentHuolongTaskMaterialReferences } from
  "../../src/shared/local-materials.js";

test("accepts task-provided contract material references before netdisk download", () => {
  const task = getLocalTencentHuolongDramaTask();

  assert.doesNotThrow(() => validateTencentHuolongTaskMaterialReferences(task));
});

test("rejects a missing cost analysis commitment before netdisk download", () => {
  const task = getLocalTencentHuolongDramaTask();
  task.playlet.costAnalysisFiles = [];

  assert.throws(
    () => validateTencentHuolongTaskMaterialReferences(task),
    /成本配置分析（承诺函）至少需要1个，实际=0/u,
  );
});

test("rejects a missing non-infringement commitment before netdisk download", () => {
  const task = getLocalTencentHuolongDramaTask();
  task.playlet.nonInfringementCommitmentFiles = [];

  assert.throws(
    () => validateTencentHuolongTaskMaterialReferences(task),
    /不侵权承诺函至少需要1个，实际=0/u,
  );
});

test("reports all missing task-provided contract materials together", () => {
  const task = getLocalTencentHuolongDramaTask();
  task.playlet.costAnalysisFiles = [];
  task.playlet.nonInfringementCommitmentFiles = [];

  assert.throws(
    () => validateTencentHuolongTaskMaterialReferences(task),
    (error: unknown) => error instanceof Error
      && error.message.includes("成本配置分析（承诺函）至少需要1个，实际=0")
      && error.message.includes("不侵权承诺函至少需要1个，实际=0"),
  );
});

test("does not start a netdisk download when contract material references are missing", async () => {
  const task = getLocalTencentHuolongDramaTask();
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
