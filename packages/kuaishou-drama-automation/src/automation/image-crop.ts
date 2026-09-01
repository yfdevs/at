import type { Locator, Page } from "playwright";

const cropCoverageSafetyPx = 2;
const cropZoomSettleMs = 80;
const maxCropZoomSteps = 60;
const cropGeometryEpsilonPx = 0.25;

export type KuaishouCropRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export type KuaishouCropCoverage = {
  covers: boolean;
  safetyPx: number;
  overflow: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
};

type CropMeasurement = {
  crop: KuaishouCropRect;
  image: KuaishouCropRect;
  viewport: { width: number; height: number };
  widthMax: boolean;
  heightMax: boolean;
  coverage: KuaishouCropCoverage;
};

export function evaluateKuaishouCropCoverage(
  crop: KuaishouCropRect,
  image: KuaishouCropRect,
  safetyPx = cropCoverageSafetyPx,
): KuaishouCropCoverage {
  const overflow = {
    left: crop.left - image.left,
    top: crop.top - image.top,
    right: image.right - crop.right,
    bottom: image.bottom - crop.bottom,
  };

  return {
    covers: Object.values(overflow).every((value) => value >= safetyPx),
    safetyPx,
    overflow,
  };
}

async function measureCrop(dialog: Locator): Promise<CropMeasurement> {
  const measurement = await dialog.evaluate((node) => {
    const viewport = node.querySelector<HTMLElement>(".vue-cropper .cropper-box");
    const cropBox = node.querySelector<HTMLElement>(".vue-cropper .cropper-crop-box");
    const imageCanvas = node.querySelector<HTMLElement>(".vue-cropper .cropper-box-canvas");
    if (!viewport || !cropBox || !imageCanvas) {
      throw new Error("KUAISHOU_DRAMA_CROP_BOX_NOT_MEASURABLE");
    }
    const viewportRect = viewport.getBoundingClientRect();
    const cropRect = cropBox.getBoundingClientRect();
    const imageRect = imageCanvas.getBoundingClientRect();
    const serializeRect = (rect: DOMRect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    return {
      crop: serializeRect(cropRect),
      image: serializeRect(imageRect),
      viewport: { width: viewportRect.width, height: viewportRect.height },
      widthMax: cropRect.width >= viewportRect.width - 3,
      heightMax: cropRect.height >= viewportRect.height - 3,
    };
  });

  return {
    ...measurement,
    coverage: evaluateKuaishouCropCoverage(measurement.crop, measurement.image),
  };
}

async function clickCropZoomButton(dialog: Locator, direction: "in" | "out") {
  return dialog.evaluate((node, zoomDirection) => {
    const handle = node.querySelector<HTMLElement>(".handle-img");
    if (!handle) return false;

    const iconSelector = zoomDirection === "in" ? ".sys-icon-add" : ".sys-icon-subtract";
    const icon = handle.querySelector<HTMLElement>(iconSelector);
    const fallbackButtons = Array.from(
      handle.querySelectorAll<HTMLElement>("button,.ks-button,[role='button']"),
    );
    const button = icon?.closest<HTMLElement>("button,.ks-button,[role='button']") ??
      fallbackButtons[zoomDirection === "in" ? 0 : 1];
    const disabled = !button ||
      button.hasAttribute("disabled") ||
      button.getAttribute("aria-disabled") === "true" ||
      button.classList.contains("is-disabled");
    if (!button || disabled) return false;

    button.click();
    return true;
  }, direction);
}

function imageGeometryChanged(before: CropMeasurement, after: CropMeasurement) {
  return (["left", "top", "right", "bottom", "width", "height"] as const)
    .some((key) => Math.abs(before.image[key] - after.image[key]) > cropGeometryEpsilonPx);
}

async function fitImageToCropArea(page: Page, dialog: Locator, initial: CropMeasurement) {
  let current = initial;
  let zoomInSteps = 0;
  let zoomOutSteps = 0;
  let limitReached = false;

  if (!current.coverage.covers) {
    for (let step = 0; step < maxCropZoomSteps; step += 1) {
      if (!await clickCropZoomButton(dialog, "in")) {
        throw new Error("KUAISHOU_DRAMA_CROP_ZOOM_IN_UNAVAILABLE");
      }
      await page.waitForTimeout(cropZoomSettleMs);
      const next = await measureCrop(dialog);
      zoomInSteps += 1;
      if (!imageGeometryChanged(current, next) && !next.coverage.covers) {
        throw new Error("KUAISHOU_DRAMA_CROP_ZOOM_IN_NOT_CHANGED");
      }
      current = next;
      if (current.coverage.covers) {
        return { measurement: current, zoomInSteps, zoomOutSteps, limitReached };
      }
    }

    throw new Error("KUAISHOU_DRAMA_CROP_IMAGE_NOT_COVERED");
  }

  for (let step = 0; step < maxCropZoomSteps; step += 1) {
    if (!await clickCropZoomButton(dialog, "out")) {
      return { measurement: current, zoomInSteps, zoomOutSteps, limitReached };
    }
    await page.waitForTimeout(cropZoomSettleMs);
    const next = await measureCrop(dialog);
    if (!imageGeometryChanged(current, next)) {
      return { measurement: current, zoomInSteps, zoomOutSteps, limitReached };
    }
    zoomOutSteps += 1;
    current = next;
    if (current.coverage.covers) continue;

    if (!await clickCropZoomButton(dialog, "in")) {
      throw new Error("KUAISHOU_DRAMA_CROP_ZOOM_RESTORE_UNAVAILABLE");
    }
    await page.waitForTimeout(cropZoomSettleMs);
    current = await measureCrop(dialog);
    zoomInSteps += 1;
    if (!current.coverage.covers) {
      throw new Error("KUAISHOU_DRAMA_CROP_ZOOM_RESTORE_FAILED");
    }
    return { measurement: current, zoomInSteps, zoomOutSteps, limitReached };
  }

  limitReached = true;
  return { measurement: current, zoomInSteps, zoomOutSteps, limitReached };
}

async function dispatchCropDrag(
  dialog: Locator,
  mode: "position-for-max-size" | "resize-to-max-size" | "center",
) {
  await dialog.evaluate((node, dragMode) => {
    const viewport = node.querySelector<HTMLElement>(".vue-cropper .cropper-box");
    const cropBox = node.querySelector<HTMLElement>(".vue-cropper .cropper-crop-box");
    const face = cropBox?.querySelector<HTMLElement>(".cropper-face");
    const resizeHandle = cropBox?.querySelector<HTMLElement>(".crop-point.point8");
    if (!viewport || !cropBox || !face || !resizeHandle) {
      throw new Error("KUAISHOU_DRAMA_CROP_DRAG_TARGET_NOT_FOUND");
    }

    const viewportRect = viewport.getBoundingClientRect();
    const cropRect = cropBox.getBoundingClientRect();
    const aspectRatio = cropRect.width / cropRect.height;
    const targetWidth = Math.min(viewportRect.width, viewportRect.height * aspectRatio);
    const targetHeight = targetWidth / aspectRatio;
    const targetX = viewportRect.left + (viewportRect.width - targetWidth) / 2;
    const targetY = viewportRect.top + (viewportRect.height - targetHeight) / 2;

    const dispatchDrag = (
      target: HTMLElement,
      from: { x: number; y: number },
      to: { x: number; y: number },
    ) => {
      const mouseEvent = (
        type: "mousedown" | "mousemove" | "mouseup",
        point: { x: number; y: number },
        buttons: number,
      ) => new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons,
        clientX: point.x,
        clientY: point.y,
        screenX: point.x,
        screenY: point.y,
      });

      target.dispatchEvent(mouseEvent("mousedown", from, 1));
      for (let step = 1; step <= 6; step += 1) {
        const progress = step / 6;
        document.dispatchEvent(mouseEvent("mousemove", {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        }, 1));
      }
      document.dispatchEvent(mouseEvent("mouseup", to, 0));
    };

    if (dragMode === "resize-to-max-size") {
      const handleRect = resizeHandle.getBoundingClientRect();
      dispatchDrag(
        resizeHandle,
        { x: handleRect.left + handleRect.width / 2, y: handleRect.top + handleRect.height / 2 },
        { x: targetX + targetWidth - 2, y: targetY + targetHeight - 2 },
      );
      return;
    }

    const faceRect = face.getBoundingClientRect();
    const from = {
      x: faceRect.left + faceRect.width / 2,
      y: faceRect.top + faceRect.height / 2,
    };
    dispatchDrag(face, from, {
      x: from.x + targetX - cropRect.left,
      y: from.y + targetY - cropRect.top,
    });
  }, mode);
}

/**
 * Maximizes vue-cropper's fixed-ratio crop rectangle without Playwright's
 * physical mouse channel, so user mouse movement and scrolling cannot break
 * an in-progress drag.
 */
export async function maximizeKuaishouImageCropArea(page: Page, dialog: Locator) {
  const cropImage = dialog.locator('img[alt="cropper-img"]').first();
  await cropImage.waitFor({ state: "visible", timeout: 10_000 });
  const imageReadyDeadline = Date.now() + 10_000;
  let imageReady = false;
  while (Date.now() < imageReadyDeadline) {
    imageReady = await cropImage.evaluate((image) => {
      const target = image as HTMLImageElement;
      return target.complete && target.naturalWidth > 0;
    }).catch(() => false);
    if (imageReady) break;
    await page.waitForTimeout(100);
  }
  if (!imageReady) {
    throw new Error("KUAISHOU_DRAMA_CROP_IMAGE_NOT_READY");
  }

  const before = await measureCrop(dialog);
  if (!before.widthMax && !before.heightMax) {
    await dispatchCropDrag(dialog, "position-for-max-size");
    await page.waitForTimeout(80);
    await dispatchCropDrag(dialog, "resize-to-max-size");
    await page.waitForTimeout(120);
  } else {
    await dispatchCropDrag(dialog, "center");
    await page.waitForTimeout(80);
  }

  const after = await measureCrop(dialog);
  if (!after.widthMax && !after.heightMax) {
    throw new Error(
      `KUAISHOU_DRAMA_CROP_NOT_MAXIMIZED: ` +
        `crop=${Math.round(after.crop.width)}x${Math.round(after.crop.height)} ` +
        `viewport=${Math.round(after.viewport.width)}x${Math.round(after.viewport.height)}`,
    );
  }
  const fitted = await fitImageToCropArea(page, dialog, after);
  const final = fitted.measurement;
  if (!final.coverage.covers) {
    const overflow = final.coverage.overflow;
    throw new Error(
      `KUAISHOU_DRAMA_CROP_IMAGE_NOT_COVERED: ` +
        `overflow=${Math.round(overflow.left)},${Math.round(overflow.top)},` +
        `${Math.round(overflow.right)},${Math.round(overflow.bottom)}`,
    );
  }
  return {
    before: before.crop,
    after: after.crop,
    viewport: after.viewport,
    image: final.image,
    coverage: final.coverage,
    zoom: {
      inSteps: fitted.zoomInSteps,
      outSteps: fitted.zoomOutSteps,
      limitReached: fitted.limitReached,
    },
  };
}
