import type { BrowserContext, Page } from "playwright";
import {
  KUAISHOU_DRAMA_EDIT_URL,
  KUAISHOU_DRAMA_LOGIN_URL,
} from "../shared/constants.js";
import type {
  KuaishouDramaRuntimeOptions,
  KuaishouDramaTaskConfig,
} from "../shared/types.js";
import {
  loginStateFromUrl,
  log,
  saveCredentialState,
  waitForLoginIfNeeded,
} from "./browser-session.js";
import {
  countFormItemsByLabel,
  fileInputByLabel,
  fillTextboxByLabel,
  fillTextboxByLabelAt,
  selectMultipleByLabel,
  selectMultipleByPlaceholder,
  selectRadioByLabel,
  selectSingleByLabel,
  selectSingleByLabelAt,
  selectSingleByPlaceholder,
  selectYearByLabel,
  setDateRangeByLabel,
  setSingleDateByLabelAt,
} from "./form-controls.js";
import { downloadRemoteAsset } from "./upload/remote-assets.js";

type BroadcastRowValue = {
  platform: string;
  path: string;
  date: string;
};

type FastControlFill =
  | {
      kind: "text";
      label: string;
      value: string | number;
      placeholder?: string;
      index?: number;
    }
  | {
      kind: "select";
      label: string;
      value: string;
      index?: number;
    };

// Short waits used only by in-page fast-fill helpers for popper rendering and Vue event settling.
const fastFillOpenSettleMs = 60;
const fastFillChangeSettleMs = 90;
const fastFillSettleMs = 60;

function shouldConfirmImageCropDialog(labelText: string, fallbackBaseName: string, logLabel: string) {
  return /(封面|海报|图片|cover|poster|image)/i.test(
    `${labelText} ${fallbackBaseName} ${logLabel}`,
  );
}

async function confirmImageCropDialog(
  page: Page,
  options: KuaishouDramaRuntimeOptions,
  logLabel: string,
) {
  type CropDialogState = {
    found: boolean;
    clicked: boolean;
    title: string;
    buttons: string[];
  };

  const searchDeadline = Date.now() + 1_200;
  const readyDeadline = Date.now() + 5_000;
  let lastState: CropDialogState | null = null;

  while (Date.now() < (lastState?.found ? readyDeadline : searchDeadline)) {
    const state = await page.evaluate<CropDialogState>(() => {
      const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
      const cropTitlePattern = /(图片\s*(剪裁|裁剪)|剪裁|裁剪|编辑图片|图片编辑|调整图片)/;
      const isVisible = (element: HTMLElement | null) => {
        if (!element) {
          return false;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.opacity !== "0"
        );
      };
      const clickElement = (element: HTMLElement) => {
        const eventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
        };
        element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
        element.dispatchEvent(new MouseEvent("mousedown", eventInit));
        element.dispatchEvent(new PointerEvent("pointerup", eventInit));
        element.dispatchEvent(new MouseEvent("mouseup", eventInit));
        element.click();
      };

      const dialogs = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".ks-dialog,.ks-dialog__wrapper,.ks-modal,[role='dialog'],.ks-popup",
        ),
      ).filter((element) => isVisible(element) && cropTitlePattern.test(normalize(element.textContent)));
      const dialog = dialogs[0];

      if (!dialog) {
        return {
          found: false,
          clicked: false,
          title: "",
          buttons: [],
        };
      }

      const buttons = Array.from(
        dialog.querySelectorAll<HTMLElement>("button,.ks-button,[role='button']"),
      ).filter(isVisible);
      const loadedImages = Array.from(dialog.querySelectorAll<HTMLImageElement>("img"))
        .filter((element) => isVisible(element) && element.complete && element.naturalWidth > 0);
      const readyCanvases = Array.from(dialog.querySelectorAll<HTMLCanvasElement>("canvas"))
        .filter((element) => isVisible(element) && element.width > 0 && element.height > 0);
      const buttonCandidates = buttons.filter((element) => {
        const text = normalize(element.textContent).replace(/\s+/g, "");
        const disabled =
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          element.classList.contains("is-disabled");

        return !disabled && ["确定", "确认", "完成", "保存"].includes(text);
      });
      const button =
        buttonCandidates.find((element) => element.classList.contains("ks-button--primary")) ??
        buttonCandidates[buttonCandidates.length - 1];

      if (!button || (loadedImages.length === 0 && readyCanvases.length === 0)) {
        return {
          found: true,
          clicked: false,
          title: normalize(dialog.textContent).slice(0, 120),
          buttons: buttons.map((element) => normalize(element.textContent)).filter(Boolean),
        };
      }

      clickElement(button);
      return {
        found: true,
        clicked: true,
        title: normalize(dialog.textContent).slice(0, 120),
        buttons: buttons.map((element) => normalize(element.textContent)).filter(Boolean),
      };
    });

    lastState = state;
    if (state.clicked) {
      log(options, `[kuaishou-drama] confirmed ${logLabel} crop dialog`);
      await page.waitForTimeout(300);
      await page
        .waitForFunction(
          () => {
            const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
            const cropTitlePattern = /(图片\s*(剪裁|裁剪)|剪裁|裁剪|编辑图片|图片编辑|调整图片)/;
            const isVisible = (element: HTMLElement | null) => {
              if (!element) {
                return false;
              }

              const rect = element.getBoundingClientRect();
              const style = window.getComputedStyle(element);
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0"
              );
            };

            return !Array.from(
              document.querySelectorAll<HTMLElement>(
                ".ks-dialog,.ks-dialog__wrapper,.ks-modal,[role='dialog'],.ks-popup",
              ),
            ).some((element) => isVisible(element) && cropTitlePattern.test(normalize(element.textContent)));
          },
          undefined,
          { timeout: 3_000 },
        )
        .catch(() => undefined);
      return true;
    }

    await page.waitForTimeout(state.found ? 150 : 100);
  }

  if (lastState?.found) {
    throw new Error(
      `KUAISHOU_DRAMA_IMAGE_CROP_CONFIRM_NOT_FOUND: ${logLabel}; buttons=${lastState.buttons.join("|")}; dialog=${lastState.title}`,
    );
  }

  return false;
}

async function waitForImageUploadCompleted(page: Page, labelText: string, logLabel: string) {
  await page
    .waitForFunction(
      (targetLabelText) => {
        const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
        const isVisible = (element: HTMLElement | null) => {
          if (!element) {
            return false;
          }

          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0"
          );
        };
        const formItem = Array.from(document.querySelectorAll<HTMLElement>("label.ks-form-item__label"))
          .find((label) => normalize(label.textContent).startsWith(targetLabelText))
          ?.closest<HTMLElement>(".ks-form-item");

        if (!formItem) {
          return false;
        }

        const imagePreview = Array.from(formItem.querySelectorAll<HTMLImageElement>("img"))
          .some((image) => (
            isVisible(image) &&
            image.complete &&
            image.naturalWidth > 0 &&
            Boolean(image.currentSrc || image.src)
          ));
        const backgroundPreview = Array.from(formItem.querySelectorAll<HTMLElement>("*"))
          .some((element) => (
            isVisible(element) &&
            window.getComputedStyle(element).backgroundImage.startsWith("url(")
          ));

        return imagePreview || backgroundPreview;
      },
      labelText,
      { timeout: 12_000 },
    )
    .catch(async () => {
      const state = await page.evaluate((targetLabelText) => {
        const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
        const formItem = Array.from(document.querySelectorAll<HTMLElement>("label.ks-form-item__label"))
          .find((label) => normalize(label.textContent).startsWith(targetLabelText))
          ?.closest<HTMLElement>(".ks-form-item");

        if (!formItem) {
          return "form item not found";
        }

        return normalize(formItem.textContent).slice(0, 240);
      }, labelText);

      throw new Error(
        `KUAISHOU_DRAMA_IMAGE_UPLOAD_NOT_CONFIRMED: ${logLabel}; field=${labelText}; state=${state}`,
      );
    });
}

async function uploadRemoteAssetByLabel(
  page: Page,
  labelText: string,
  assetUrl: string,
  fallbackBaseName: string,
  logLabel: string,
  options: KuaishouDramaRuntimeOptions,
) {
  const filePath = await downloadRemoteAsset(assetUrl, options, fallbackBaseName, logLabel);
  const input = await fileInputByLabel(page, labelText);
  await input.setInputFiles(filePath, { timeout: 60_000 });

  const shouldConfirmCrop = shouldConfirmImageCropDialog(labelText, fallbackBaseName, logLabel);
  const cropConfirmed = shouldConfirmCrop
    ? await confirmImageCropDialog(page, options, logLabel)
    : false;
  if (shouldConfirmCrop) {
    await waitForImageUploadCompleted(page, labelText, logLabel);
    log(options, `[kuaishou-drama] ${logLabel} upload confirmed`);
    return;
  }

  await page.waitForTimeout(cropConfirmed ? 500 : 250);
}

async function fillFormControlsFast(page: Page, controls: FastControlFill[]) {
  const serializableControls = controls.map((control) => ({
    ...control,
    value: String(control.value),
  }));
  const result = await page.evaluate(async ({ controls: browserControls, openSettleMs, changeSettleMs }) => {
    const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
    const sleep = (ms: number) => new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
    const isVisible = (element: HTMLElement | null) => {
      if (!element) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const dispatchClick = (element: HTMLElement) => {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
      };
      element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent(new PointerEvent("pointerup", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      element.click();
    };
    const formItemsByLabel = (labelText: string) => (
      Array.from(document.querySelectorAll<HTMLElement>("label.ks-form-item__label"))
        .filter((label) => normalize(label.textContent).startsWith(labelText))
        .map((label) => label.closest<HTMLElement>(".ks-form-item"))
        .filter((element): element is HTMLElement => Boolean(element))
    );
    const formItemByLabel = (labelText: string, index = 0) => formItemsByLabel(labelText)[index] ?? null;
    const setNativeInputValue = (
      element: HTMLInputElement | HTMLTextAreaElement,
      value: string,
    ) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: "insertText",
      }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

      let parent = element.parentElement;
      for (let depth = 0; depth < 5 && parent; depth += 1) {
        parent.dispatchEvent(new Event("input", { bubbles: true }));
        parent.dispatchEvent(new Event("change", { bubbles: true }));
        parent = parent.parentElement;
      }
    };
    const fillTextInFormItem = (formItem: HTMLElement, value: string, placeholder?: string) => {
      const inputs = Array.from(formItem.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        "input:not([type='file']), textarea",
      ));
      const input = placeholder
        ? inputs.find((element) => element.getAttribute("placeholder") === placeholder) ?? inputs[0]
        : inputs[0];
      if (!input) {
        return false;
      }

      setNativeInputValue(input, value);
      return input.value === value;
    };
    const findVisibleOptions = (popperId: string | null) => {
      const popper = popperId ? document.getElementById(popperId) : null;
      const scopes = popper && isVisible(popper)
        ? [popper]
        : Array.from(document.querySelectorAll<HTMLElement>(".ks-select-dropdown,[role='listbox']"))
            .filter(isVisible);
      const searchRoot = scopes[0] ?? document.body;
      return {
        searchRoot,
        options: Array.from(
          searchRoot.querySelectorAll<HTMLElement>(".ks-select-dropdown__item,[role='option']"),
        ),
      };
    };
    const selectSingleInFormItem = async (formItem: HTMLElement, value: string) => {
      const selectRoot = formItem.querySelector<HTMLElement>(".ks-select");
      if (!selectRoot) {
        return {
          ok: false,
          reason: `select root missing for ${value}`,
          options: [] as string[],
        };
      }

      const input = selectRoot.querySelector<HTMLInputElement>("input.ks-input__inner");
      if (normalize(input?.value) === value) {
        return {
          ok: true,
          reason: "",
          options: [] as string[],
        };
      }

      const trigger = selectRoot.querySelector<HTMLElement>(".select-trigger") ?? input ?? selectRoot;
      dispatchClick(trigger);
      input?.focus({ preventScroll: true });
      await sleep(openSettleMs);

      const popperId =
        trigger.getAttribute("aria-describedby") ??
        input?.getAttribute("aria-describedby") ??
        null;
      const { searchRoot, options } = findVisibleOptions(popperId);
      const option = options.find((element) => normalize(element.textContent) === value);

      if (!option) {
        return {
          ok: false,
          reason: `option missing for ${value}`,
          options: options.map((element) => normalize(element.textContent)).filter(Boolean),
        };
      }

      let parent = option.parentElement;
      while (parent && parent !== searchRoot) {
        const style = window.getComputedStyle(parent);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 4;

        if (canScroll) {
          const optionRect = option.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          if (optionRect.top < parentRect.top) {
            parent.scrollTop -= parentRect.top - optionRect.top;
          } else if (optionRect.bottom > parentRect.bottom) {
            parent.scrollTop += optionRect.bottom - parentRect.bottom;
          }
          break;
        }

        parent = parent.parentElement;
      }

      dispatchClick(option);
      await sleep(changeSettleMs);
      input?.blur();
      document.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
        code: "Escape",
      }));

      if (normalize(input?.value) === value) {
        return {
          ok: true,
          reason: "",
          options: [] as string[],
        };
      }

      return {
        ok: false,
        reason: `select value not updated for ${value}`,
        options: options.map((element) => normalize(element.textContent)).filter(Boolean),
      };
    };

    for (const [index, control] of browserControls.entries()) {
      const formItem = formItemByLabel(control.label, control.index ?? 0);
      if (!formItem) {
        return {
          ok: false,
          reason: `form item missing for ${control.label} at control ${index + 1}`,
          options: [] as string[],
        };
      }

      if (control.kind === "text") {
        if (!fillTextInFormItem(formItem, control.value, control.placeholder)) {
          return {
            ok: false,
            reason: `text fill failed for ${control.label}`,
            options: [] as string[],
          };
        }
        continue;
      }

      const selectResult = await selectSingleInFormItem(formItem, control.value);
      if (!selectResult.ok) {
        return {
          ok: false,
          reason: `${selectResult.reason} for ${control.label}`,
          options: selectResult.options,
        };
      }
    }

    return {
      ok: true,
      reason: "",
      options: [] as string[],
    };
  }, {
    controls: serializableControls,
    openSettleMs: fastFillOpenSettleMs,
    changeSettleMs: fastFillChangeSettleMs,
  });

  if (!result.ok) {
    throw new Error(
      `KUAISHOU_DRAMA_FAST_CONTROL_FILL_FAILED: ${result.reason}; options=${result.options.join("|")}`,
    );
  }

  await page.waitForTimeout(fastFillSettleMs);
}

async function fillMainActorInfo(
  page: Page,
  taskConfig: KuaishouDramaTaskConfig,
  options: KuaishouDramaRuntimeOptions,
) {
  try {
    await fillFormControlsFast(page, [
      { kind: "text", label: "演员姓名", value: taskConfig.actorName, placeholder: "请输入" },
      { kind: "select", label: "演员性别", value: taskConfig.actorGender },
      { kind: "text", label: "演员角色", value: taskConfig.actorRole, placeholder: "请输入角色名" },
    ]);
    return;
  } catch (error) {
    log(
      options,
      `[kuaishou-drama] main actor fast fill fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await fillTextboxByLabel(page, "演员姓名", taskConfig.actorName, "请输入");
  await selectSingleByLabel(page, "演员性别", taskConfig.actorGender);
  await fillTextboxByLabel(page, "演员角色", taskConfig.actorRole, "请输入角色名");
}

async function fillBroadcastRow(
  page: Page,
  rowIndex: number,
  platform: string,
  broadcastPath: string,
  broadcastDate: string,
) {
  await fillTextboxByLabelAt(page, "播出平台", platform, "请输入播出平台", rowIndex);
  await selectSingleByLabelAt(page, "播出途径", broadcastPath, rowIndex);
  await setSingleDateByLabelAt(page, "播出时间", broadcastDate, rowIndex);
}

async function clickAddBroadcastPlatform(page: Page) {
  const state = await page.evaluate(() => {
    const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>("button,.ks-button,[role='button']"),
    ).filter(isVisible);
    const button = candidates.find((element) => normalize(element.textContent) === "新增播出平台");

    if (!button) {
      return {
        clicked: false,
        buttonTexts: candidates
          .map((element) => normalize(element.textContent))
          .filter(Boolean),
      };
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
    };
    button.dispatchEvent(new PointerEvent("pointerdown", eventInit));
    button.dispatchEvent(new MouseEvent("mousedown", eventInit));
    button.dispatchEvent(new PointerEvent("pointerup", eventInit));
    button.dispatchEvent(new MouseEvent("mouseup", eventInit));
    button.click();

    return {
      clicked: true,
      buttonTexts: [] as string[],
    };
  });

  if (!state.clicked) {
    throw new Error(
      `KUAISHOU_DRAMA_BROADCAST_ADD_BUTTON_NOT_FOUND: buttons=${state.buttonTexts.join("|")}`,
    );
  }

  await page.waitForTimeout(fastFillSettleMs);
}

async function ensureBroadcastRows(
  page: Page,
  targetCount: number,
  options: KuaishouDramaRuntimeOptions,
) {
  for (let attempt = 0; attempt < targetCount + 3; attempt += 1) {
    const currentCount = await countFormItemsByLabel(page, "播出平台");
    if (currentCount >= targetCount) {
      return;
    }

    log(options, `[kuaishou-drama] adding broadcast row ${currentCount + 1}`);
    await clickAddBroadcastPlatform(page);
    await page
      .waitForFunction(
        (expectedCount) => {
          const labels = Array.from(document.querySelectorAll("label.ks-form-item__label"));
          return labels.filter((label) => /^播出平台/.test(label.textContent?.trim() ?? "")).length >= expectedCount;
        },
        currentCount + 1,
        { timeout: 5_000 },
      )
      .catch(() => undefined);
  }

  throw new Error(
    `KUAISHOU_DRAMA_BROADCAST_ROW_COUNT_NOT_REACHED: ${await countFormItemsByLabel(page, "播出平台")}/${targetCount}`,
  );
}

async function fillBroadcastRowsFast(page: Page, rows: BroadcastRowValue[]) {
  const result = await page.evaluate(async ({ broadcastRows, openSettleMs, changeSettleMs }) => {
    const normalize = (text: string | null | undefined) => text?.replace(/\s+/g, " ").trim() ?? "";
    const sleep = (ms: number) => new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
    const isVisible = (element: HTMLElement | null) => {
      if (!element) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const dispatchClick = (element: HTMLElement) => {
      const eventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
      };
      element.dispatchEvent(new PointerEvent("pointerdown", eventInit));
      element.dispatchEvent(new MouseEvent("mousedown", eventInit));
      element.dispatchEvent(new PointerEvent("pointerup", eventInit));
      element.dispatchEvent(new MouseEvent("mouseup", eventInit));
      element.click();
    };
    const formItemsByLabel = (labelText: string) => (
      Array.from(document.querySelectorAll<HTMLElement>("label.ks-form-item__label"))
        .filter((label) => normalize(label.textContent).startsWith(labelText))
        .map((label) => label.closest<HTMLElement>(".ks-form-item"))
        .filter((element): element is HTMLElement => Boolean(element))
    );
    const setNativeInputValue = (
      element: HTMLInputElement | HTMLTextAreaElement,
      value: string,
    ) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
      if (descriptor?.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }

      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: "insertText",
      }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

      let parent = element.parentElement;
      for (let depth = 0; depth < 5 && parent; depth += 1) {
        parent.dispatchEvent(new Event("input", { bubbles: true }));
        parent.dispatchEvent(new Event("change", { bubbles: true }));
        parent = parent.parentElement;
      }
    };
    const fillTextInFormItem = (formItem: HTMLElement, value: string) => {
      const input = formItem.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "input:not([type='file']), textarea",
      );
      if (!input) {
        return false;
      }

      setNativeInputValue(input, value);
      return input.value === value;
    };
    const setDateInFormItem = (formItem: HTMLElement, value: string) => {
      const input = formItem.querySelector<HTMLInputElement>("input.ks-input__inner,input:not([type='file'])");
      if (!input) {
        return false;
      }

      setNativeInputValue(input, value);
      const normalizedActual = input.value.trim().slice(0, 10).replace(/\//g, "-");
      return normalizedActual === value;
    };
    const findVisibleOptions = (popperId: string | null) => {
      const popper = popperId ? document.getElementById(popperId) : null;
      const scopes = popper && isVisible(popper)
        ? [popper]
        : Array.from(document.querySelectorAll<HTMLElement>(".ks-select-dropdown,[role='listbox']"))
            .filter(isVisible);
      const searchRoot = scopes[0] ?? document.body;
      return {
        searchRoot,
        options: Array.from(
          searchRoot.querySelectorAll<HTMLElement>(".ks-select-dropdown__item,[role='option']"),
        ),
      };
    };
    const selectSingleInFormItem = async (formItem: HTMLElement, value: string) => {
      const selectRoot = formItem.querySelector<HTMLElement>(".ks-select");
      if (!selectRoot) {
        return {
          ok: false,
          reason: `select root missing for ${value}`,
          options: [] as string[],
        };
      }

      const input = selectRoot.querySelector<HTMLInputElement>("input.ks-input__inner");
      if (normalize(input?.value) === value) {
        return {
          ok: true,
          reason: "",
          options: [] as string[],
        };
      }

      const trigger = selectRoot.querySelector<HTMLElement>(".select-trigger") ?? input ?? selectRoot;
      dispatchClick(trigger);
      input?.focus({ preventScroll: true });
      await sleep(openSettleMs);

      const popperId =
        trigger.getAttribute("aria-describedby") ??
        input?.getAttribute("aria-describedby") ??
        null;
      const { searchRoot, options } = findVisibleOptions(popperId);
      const option = options.find((element) => normalize(element.textContent) === value);

      if (!option) {
        return {
          ok: false,
          reason: `option missing for ${value}`,
          options: options.map((element) => normalize(element.textContent)).filter(Boolean),
        };
      }

      let parent = option.parentElement;
      while (parent && parent !== searchRoot) {
        const style = window.getComputedStyle(parent);
        const canScroll =
          /(auto|scroll)/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 4;

        if (canScroll) {
          const optionRect = option.getBoundingClientRect();
          const parentRect = parent.getBoundingClientRect();
          if (optionRect.top < parentRect.top) {
            parent.scrollTop -= parentRect.top - optionRect.top;
          } else if (optionRect.bottom > parentRect.bottom) {
            parent.scrollTop += optionRect.bottom - parentRect.bottom;
          }
          break;
        }

        parent = parent.parentElement;
      }

      dispatchClick(option);
      await sleep(changeSettleMs);
      input?.blur();
      document.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
        code: "Escape",
      }));

      if (normalize(input?.value) === value) {
        return {
          ok: true,
          reason: "",
          options: [] as string[],
        };
      }

      return {
        ok: false,
        reason: `select value not updated for ${value}`,
        options: options.map((element) => normalize(element.textContent)).filter(Boolean),
      };
    };

    const platformItems = formItemsByLabel("播出平台");
    const pathItems = formItemsByLabel("播出途径");
    const timeItems = formItemsByLabel("播出时间");
    if (
      platformItems.length < broadcastRows.length ||
      pathItems.length < broadcastRows.length ||
      timeItems.length < broadcastRows.length
    ) {
      return {
        ok: false,
        reason: `broadcast fields missing: platform=${platformItems.length}, path=${pathItems.length}, time=${timeItems.length}, expected=${broadcastRows.length}`,
        options: [] as string[],
      };
    }

    for (const [index, row] of broadcastRows.entries()) {
      if (!fillTextInFormItem(platformItems[index], row.platform)) {
        return {
          ok: false,
          reason: `platform fill failed at row ${index + 1}`,
          options: [] as string[],
        };
      }

      const selectResult = await selectSingleInFormItem(pathItems[index], row.path);
      if (!selectResult.ok) {
        return {
          ok: false,
          reason: `${selectResult.reason} at row ${index + 1}`,
          options: selectResult.options,
        };
      }

      if (!setDateInFormItem(timeItems[index], row.date)) {
        return {
          ok: false,
          reason: `date fill failed at row ${index + 1}`,
          options: [] as string[],
        };
      }
    }

    return {
      ok: true,
      reason: "",
      options: [] as string[],
    };
  }, {
    broadcastRows: rows,
    openSettleMs: fastFillOpenSettleMs,
    changeSettleMs: fastFillChangeSettleMs,
  });

  if (!result.ok) {
    throw new Error(
      `KUAISHOU_DRAMA_BROADCAST_FAST_FILL_FAILED: ${result.reason}; options=${result.options.join("|")}`,
    );
  }

  await page.waitForTimeout(fastFillSettleMs);
}

async function fillBroadcastInfo(
  page: Page,
  taskConfig: KuaishouDramaTaskConfig,
  options: KuaishouDramaRuntimeOptions,
) {
  await ensureBroadcastRows(page, taskConfig.broadcastPaths.length, options);

  const rows = taskConfig.broadcastPaths.map((broadcastPath) => ({
    platform: taskConfig.broadcastPlatform,
    path: broadcastPath,
    date: taskConfig.broadcastDate,
  }));

  try {
    log(options, "[kuaishou-drama] filling broadcast rows");
    await fillBroadcastRowsFast(page, rows);
    return;
  } catch (error) {
    log(
      options,
      `[kuaishou-drama] broadcast fast fill fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const [index, broadcastPath] of taskConfig.broadcastPaths.entries()) {
    log(options, `[kuaishou-drama] filling broadcast row ${index + 1}`);
    await fillBroadcastRow(
      page,
      index,
      taskConfig.broadcastPlatform,
      broadcastPath,
      taskConfig.broadcastDate,
    );
  }
}

async function fillPersonnelInfo(
  page: Page,
  taskConfig: KuaishouDramaTaskConfig,
  options: KuaishouDramaRuntimeOptions,
) {
  try {
    await fillFormControlsFast(page, [
      { kind: "text", label: "导演姓名", value: taskConfig.directorName, placeholder: "请输入" },
      { kind: "select", label: "导演性别", value: taskConfig.directorGender },
      { kind: "text", label: "编剧姓名", value: taskConfig.screenwriterName, placeholder: "请输入" },
      { kind: "select", label: "编剧性别", value: taskConfig.screenwriterGender },
      { kind: "text", label: "制片人姓名", value: taskConfig.producerName, placeholder: "请输入" },
      { kind: "select", label: "制片人性别", value: taskConfig.producerGender },
    ]);
    return;
  } catch (error) {
    log(
      options,
      `[kuaishou-drama] personnel fast fill fallback: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await fillTextboxByLabel(page, "导演姓名", taskConfig.directorName, "请输入");
  await selectSingleByLabel(page, "导演性别", taskConfig.directorGender);

  await fillTextboxByLabel(page, "编剧姓名", taskConfig.screenwriterName, "请输入");
  await selectSingleByLabel(page, "编剧性别", taskConfig.screenwriterGender);

  await fillTextboxByLabel(page, "制片人姓名", taskConfig.producerName, "请输入");
  await selectSingleByLabel(page, "制片人性别", taskConfig.producerGender);
}

export async function fillKuaishouDramaEditForm(
  page: Page,
  taskConfig: KuaishouDramaTaskConfig,
  options: KuaishouDramaRuntimeOptions,
) {
  const remoteAssetDirectoryName = taskConfig.title;

  log(options, "[kuaishou-drama] filling drama title");
  await fillTextboxByLabel(page, "短剧标题", taskConfig.title, "请输入");

  log(options, "[kuaishou-drama] uploading drama cover");
  await uploadRemoteAssetByLabel(
    page,
    "短剧封面",
    taskConfig.coverImageUrl,
    `${remoteAssetDirectoryName}-cover`,
    "short drama cover",
    options,
  );

  log(options, "[kuaishou-drama] filling drama summary");
  await fillTextboxByLabel(
    page,
    "短剧简介",
    taskConfig.summary,
    "请输入100～400字的短剧简介，覆盖完整剧情",
  );

  log(options, "[kuaishou-drama] selecting content channel");
  await selectSingleByPlaceholder(page, "请选择男女频道", taskConfig.genderChannel);

  log(options, "[kuaishou-drama] selecting content categories");
  await selectMultipleByPlaceholder(page, "请选择短剧分类", [...taskConfig.categories]);

  log(options, "[kuaishou-drama] selecting plot tags");
  await selectMultipleByPlaceholder(page, "请选择短剧情节", [...taskConfig.plotTags]);

  log(options, "[kuaishou-drama] selecting content type");
  await selectRadioByLabel(page, "内容类型", taskConfig.contentType);

  log(options, "[kuaishou-drama] selecting production method");
  await selectSingleByLabel(page, "漫剧制作方式", taskConfig.productionMethod);

  log(options, "[kuaishou-drama] selecting completion status");
  await selectRadioByLabel(page, "是否完结", taskConfig.isCompleted);

  log(options, "[kuaishou-drama] selecting full scene display");
  await selectRadioByLabel(page, "是否全场景展示", taskConfig.fullSceneDisplay);

  log(options, "[kuaishou-drama] selecting copyright proof type");
  await selectSingleByLabel(page, "版权证明类型", taskConfig.copyrightProofType);

  log(options, "[kuaishou-drama] uploading authorization promotion file");
  await uploadRemoteAssetByLabel(
    page,
    "授权推广文件",
    taskConfig.authorizationPromotionFileUrl,
    `${remoteAssetDirectoryName}-authorization-promotion`,
    "authorization promotion file",
    options,
  );

  log(options, "[kuaishou-drama] selecting copyright materials");
  await selectMultipleByLabel(page, "版权证明材料", [...taskConfig.copyrightMaterials]);

  log(options, "[kuaishou-drama] uploading copyright declaration file");
  await uploadRemoteAssetByLabel(
    page,
    "短剧制作协议/权属声明",
    taskConfig.copyrightDeclarationFileUrl,
    `${remoteAssetDirectoryName}-copyright-declaration`,
    "copyright declaration file",
    options,
  );

  log(options, "[kuaishou-drama] setting copyright validity range");
  await setDateRangeByLabel(
    page,
    "版权有效期",
    taskConfig.copyrightValidityStartDate,
    taskConfig.copyrightValidityEndDate,
  );

  log(options, "[kuaishou-drama] selecting sublicensing right");
  await selectRadioByLabel(page, "是否具备转授权权利", taskConfig.sublicensingRight);

  log(options, "[kuaishou-drama] selecting record number status");
  await selectRadioByLabel(page, "是否有备案号", taskConfig.hasRecordNumber);

  if (taskConfig.hasRecordNumber === "否") {
    log(options, "[kuaishou-drama] filling main actor info");
    await fillMainActorInfo(page, taskConfig, options);

    log(options, "[kuaishou-drama] selecting production year");
    await selectYearByLabel(page, "出品年份", taskConfig.productionYear);

    log(options, "[kuaishou-drama] filling production cost and episode duration");
    try {
      await fillFormControlsFast(page, [
        {
          kind: "text",
          label: "制作成本 (万)",
          value: taskConfig.productionCostWan,
          placeholder: "请输入制作成本",
        },
        {
          kind: "text",
          label: "单集平均时长 (分)",
          value: taskConfig.averageEpisodeDurationMinutes,
          placeholder: "请输入单集平均时长",
        },
      ]);
    } catch (error) {
      log(
        options,
        `[kuaishou-drama] production metrics fast fill fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await fillTextboxByLabel(page, "制作成本 (万)", taskConfig.productionCostWan, "请输入制作成本");
      await fillTextboxByLabel(
        page,
        "单集平均时长 (分)",
        taskConfig.averageEpisodeDurationMinutes,
        "请输入单集平均时长",
      );
    }

    log(options, "[kuaishou-drama] uploading poster image");
    await uploadRemoteAssetByLabel(
      page,
      "海报图片",
      taskConfig.posterImageUrl,
      `${remoteAssetDirectoryName}-poster`,
      "poster image",
      options,
    );

    log(options, "[kuaishou-drama] filling broadcast info");
    await fillBroadcastInfo(page, taskConfig, options);

    log(options, "[kuaishou-drama] filling personnel info");
    await fillPersonnelInfo(page, taskConfig, options);

    log(options, "[kuaishou-drama] filling production organization");
    try {
      await fillFormControlsFast(page, [
        {
          kind: "text",
          label: "制作机构",
          value: taskConfig.productionOrganization,
          placeholder: "请输入制作机构",
        },
      ]);
    } catch (error) {
      log(
        options,
        `[kuaishou-drama] production organization fast fill fallback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await fillTextboxByLabel(
        page,
        "制作机构",
        taskConfig.productionOrganization,
        "请输入制作机构",
      );
    }

    log(options, "[kuaishou-drama] selecting special subject status");
    await selectRadioByLabel(
      page,
      "是否涉及重大革命和历史或特殊题材",
      taskConfig.specialSubjectInvolved,
    );
  }

  log(options, "[kuaishou-drama] edit form fields completed");
}

export async function runPublishTask(
  context: BrowserContext,
  page: Page,
  options: KuaishouDramaRuntimeOptions,
  taskConfig: KuaishouDramaTaskConfig | null,
) {
  log(options, "[kuaishou-drama] opening edit page");
  await page.goto(KUAISHOU_DRAMA_EDIT_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });

  if (loginStateFromUrl(page.url()) === "login-required") {
    await page.goto(KUAISHOU_DRAMA_LOGIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (await waitForLoginIfNeeded(page, options)) {
      await saveCredentialState(context, options);
    }
    if (!page.url().includes("/home/content/content-management/edit")) {
      await page.goto(KUAISHOU_DRAMA_EDIT_URL, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
  }

  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
  await page.getByText("短剧标题", { exact: true }).waitFor({ state: "visible", timeout: 60_000 });
  await saveCredentialState(context, options);

  if (!taskConfig) {
    log(options, "[kuaishou-drama] task config not provided, browser is ready");
    return;
  }

  await fillKuaishouDramaEditForm(page, taskConfig, options);
}
