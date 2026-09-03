import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateKuaishouCropCoverage,
  type KuaishouCropRect,
} from "../../src/automation/image-crop.js";

function rect(left: number, top: number, width: number, height: number): KuaishouCropRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

void test("accepts an image that safely covers every crop edge", () => {
  const result = evaluateKuaishouCropCoverage(
    rect(100, 100, 348, 466),
    rect(92, 89, 367, 489),
  );

  assert.equal(result.covers, true);
  assert.deepEqual(result.overflow, {
    left: 8,
    top: 11,
    right: 11,
    bottom: 12,
  });
});

void test("rejects sub-pixel edge coverage that is vulnerable to browser rounding", () => {
  const result = evaluateKuaishouCropCoverage(
    rect(100, 100, 348, 466),
    rect(99.1, 98.5, 351.8, 469),
  );

  assert.equal(result.covers, false);
  assert.ok(result.overflow.left < result.safetyPx);
  assert.ok(result.overflow.top < result.safetyPx);
});

void test("rejects an image when any single crop edge is exposed", () => {
  const result = evaluateKuaishouCropCoverage(
    rect(100, 100, 348, 466),
    rect(90, 90, 357, 485),
  );

  assert.equal(result.covers, false);
  assert.equal(result.overflow.right, -1);
});
