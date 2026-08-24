import type { Locator, Page } from "playwright";

type CropMeasurement = {
  crop: { width: number; height: number };
  viewport: { width: number; height: number };
  widthMax: boolean;
  heightMax: boolean;
};

async function measureCrop(dialog: Locator): Promise<CropMeasurement> {
  return dialog.evaluate((node) => {
    const viewport = node.querySelector<HTMLElement>(".vue-cropper .cropper-box");
    const cropBox = node.querySelector<HTMLElement>(".vue-cropper .cropper-crop-box");
    if (!viewport || !cropBox) {
      throw new Error("KUAISHOU_DRAMA_CROP_BOX_NOT_MEASURABLE");
    }
    const viewportRect = viewport.getBoundingClientRect();
    const cropRect = cropBox.getBoundingClientRect();
    return {
      crop: { width: cropRect.width, height: cropRect.height },
      viewport: { width: viewportRect.width, height: viewportRect.height },
      widthMax: cropRect.width >= viewportRect.width - 3,
      heightMax: cropRect.height >= viewportRect.height - 3,
    };
  });
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
  return {
    before: before.crop,
    after: after.crop,
    viewport: after.viewport,
  };
}
