import type { Page } from "playwright";
import { log } from "../../shared/logger.js";
import type {
  ClaimedQqDramaTask,
  QqDramaRuntimeOptions,
  QqDramaTaskField,
  QqDramaTaskFile,
} from "../../shared/types.js";
import { clickNextStep, fillTaskField, uploadTaskFile } from "./form-controls.js";
import { taskTitle } from "./payload.js";

type OptionalTaskField = Omit<QqDramaTaskField, "index" | "value"> & {
  index?: number;
  value?: string | number | boolean | null;
};

function fileFromRef(
  label: string,
  fileRef: string | undefined,
  fileName: string,
): QqDramaTaskFile | null {
  if (!fileRef?.trim()) return null;
  const ref = fileRef.trim();
  return /^https?:\/\//i.test(ref) ? { label, url: ref, fileName } : { label, path: ref, fileName };
}

function firstAvailableFileRef(...fileRefs: Array<string | undefined>) {
  return fileRefs.find((fileRef) => Boolean(fileRef?.trim()));
}

async function fillFieldIfPresent(
  page: Page,
  options: QqDramaRuntimeOptions,
  field: OptionalTaskField,
) {
  if (field.value === undefined || field.value === null || field.value === "") return false;

  log(options, `[qq-drama] filling field: ${field.selector ?? field.label ?? "unknown"}`);
  await fillTaskField(page, {
    ...field,
    index: field.index ?? 0,
    value: field.value,
  });
  return true;
}

async function uploadFileIfPresent(
  page: Page,
  options: QqDramaRuntimeOptions,
  file: QqDramaTaskFile | null,
) {
  if (!file) return false;

  log(options, `[qq-drama] uploading file: ${file.selector ?? file.label ?? "unknown"}`);
  await uploadTaskFile(page, file, options);
  return true;
}

// async function addRoleInfoIfPresent(
//   page: Page,
//   roles: QqDramaRole[] | undefined,
//   options: QqDramaRuntimeOptions,
// ) {
//   if (!roles?.length) return false;

//   for (const role of roles) {
//     log(options, `[qq-drama] adding role: ${role.name}`);
//     await page
//       .getByRole("button", { name: /添加角色信息|添加角色/ })
//       .first()
//       .click({ timeout: 15_000 });
//     await fillFieldByLabel(page, {
//       label: "角色名称",
//       value: role.name,
//       kind: "text",
//       placeholder: "请输入角色名称",
//       index: 0,
//     });
//     if (role.description) {
//       await fillFieldByLabel(page, {
//         label: "角色简介",
//         value: role.description,
//         kind: "textarea",
//         placeholder: "请输入角色描述（选填）",
//         index: 0,
//       });
//     }
//     if (role.imageFile) {
//       await uploadTaskFile(
//         page,
//         {
//           label: "角色图片",
//           path: /^https?:\/\//i.test(role.imageFile) ? undefined : role.imageFile,
//           url: /^https?:\/\//i.test(role.imageFile) ? role.imageFile : undefined,
//           fileName: `role-${role.name}`,
//         },
//         options,
//       );
//     }
//     await page.getByRole("button", { name: "保存" }).first().click({ timeout: 15_000 });
//     await page.waitForTimeout(500);
//   }

//   return true;
// }

export async function fillBasicInfoStep(
  page: Page,
  task: ClaimedQqDramaTask,
  options: QqDramaRuntimeOptions,
) {
  const payload = task.playlet;
  const title = taskTitle(payload);

  await fillFieldIfPresent(page, options, {
    label: "作品名称",
    value: payload.title ?? title,
    kind: "text",
    placeholder: "请输入（审核通过后不支持修改）",
  });
  await fillFieldIfPresent(page, options, {
    label: "作品简介",
    value: payload.summary,
    kind: "textarea",
    placeholder: "请输入作品简介",
  });
  await fillFieldIfPresent(page, options, {
    label: "受众类型",
    value: payload.audienceType,
    kind: "radio",
  });
  await uploadFileIfPresent(
    page,
    options,
    fileFromRef(
      "封面图",
      firstAvailableFileRef(payload.coverImageFile, payload.coverImageUrl, payload.posterImageUrl),
      "cover",
    ),
  );

  // 基础信息
  await fillFieldIfPresent(page, options, {
    label: "承诺总集数",
    value: payload.episodeCount,
    kind: "text",
    placeholder: "1 ~ 1000",
  });
  await fillFieldIfPresent(page, options, {
    label: "更新状态",
    value: payload.updateStatus,
    kind: "radio",
  });
  await fillFieldIfPresent(page, options, {
    label: "是否 AI 作品",
    value: payload.isAiGenerated,
    kind: "radio",
  });
  await fillFieldIfPresent(page, options, {
    label: "分类",
    value: payload.primaryCategory,
    kind: "select",
    placeholder: "请选择一级分类",
    index: 0,
  });
  await fillFieldIfPresent(page, options, {
    label: "分类",
    value: payload.secondaryCategory,
    kind: "select",
    placeholder: "请选择二级分类（可选）",
    index: 0,
  });
  await fillFieldIfPresent(page, options, {
    label: "是否系列剧",
    value: payload.isSeries,
    kind: "radio",
  });
  await fillFieldIfPresent(page, options, {
    label: "漫剧类型",
    value: payload.comicType,
    kind: "radio",
  });

  // 制作团队
  await fillFieldIfPresent(page, options, {
    label: "制作机构",
    value: payload.productionOrganization,
    kind: "text",
    placeholder: "请输入制作机构（个人创作者可填「无」）",
  });
  await fillFieldIfPresent(page, options, {
    label: "制片人",
    value: payload.producers?.join("，"),
    kind: "text",
    placeholder: "多个请用逗号分隔",
  });
  await fillFieldIfPresent(page, options, {
    label: "导演",
    value: payload.directors?.join("，"),
    kind: "text",
    placeholder: "多个请用逗号分隔",
  });
  await fillFieldIfPresent(page, options, {
    label: "编剧",
    value: payload.screenwriters?.join("，"),
    kind: "text",
    placeholder: "多个请用逗号分隔（选填）",
  });
  // await addRoleInfoIfPresent(page, payload.roles, options);

  // 备案信息
  await fillFieldIfPresent(page, options, {
    label: "制作成本范围",
    value: payload.productionCostRange,
    kind: "radio",
  });
  await fillFieldIfPresent(page, options, {
    label: "具体成本",
    value: payload.productionCostWan,
    kind: "text",
    placeholder: "请输入",
  });
  await fillFieldIfPresent(page, options, {
    label: "年份",
    value: payload.productionYear,
    kind: "text",
    placeholder: "如 2026",
  });
  await uploadFileIfPresent(
    page,
    options,
    fileFromRef("成本配置比例情况报告", payload.costAllocationReportFile, "cost-allocation-report"),
  );

  // 版权信息
  await uploadFileIfPresent(
    page,
    options,
    fileFromRef("权属文件", payload.copyrightProofFile, "copyright-proof"),
  );

  // 合同
  await fillFieldIfPresent(page, options, {
    label: "选择合同",
    value: payload.contractName,
    kind: "select",
    placeholder: "请选择合同",
  });
  // oxlint-disable-next-line no-debugger
  debugger;
  if (payload.episodeCount || payload.submit) {
    await clickNextStep(page, options);
  }
}
