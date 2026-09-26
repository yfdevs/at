import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePinduoduoResourceTitle,
  resolvePinduoduoResource,
  type PinduoduoLegacyResourceLink,
} from "../../src/storage/pinduoduo-legacy-resource-links.js";
import { PINDUODUO_LEGACY_RESOURCE_LINKS } from "../../src/shared/pinduoduo-legacy-resource-links.generated.js";

function legacyLink(
  overrides: Partial<PinduoduoLegacyResourceLink> = {},
): PinduoduoLegacyResourceLink {
  return {
    normalizedTitle: "果园的天平",
    title: "果园的天平",
    originalShareText: "https://pan.baidu.com/s/example 提取码: 1234",
    baiduUrl: "https://pan.baidu.com/s/example",
    sourceDate: "2026-09-22",
    episodeCount: 43,
    sourceRows: [1200],
    available: true,
    ...overrides,
  };
}

test("normalizes harmless title formatting without fuzzy matching", () => {
  assert.equal(normalizePinduoduoResourceTitle("  果 园的天平？！  "), "果园的天平");
  assert.notEqual(normalizePinduoduoResourceTitle("果园天平"), "果园的天平");
});

test("uses the historical spreadsheet original link when the title matches", () => {
  const resolved = resolvePinduoduoResource(
    "果园的天平",
    "https://pan.baidu.com/s/sample",
    legacyLink(),
  );

  assert.equal(resolved.source, "LEGACY_XLSX_ORIGINAL");
  assert.equal(resolved.shareText, "https://pan.baidu.com/s/example 提取码: 1234");
  assert.deepEqual(resolved.sourceRows, [1200]);
});

test("fails closed when a matched historical row has no original link", () => {
  assert.throws(
    () => resolvePinduoduoResource(
      "缺少原链接的旧剧",
      "https://pan.baidu.com/s/sample",
      legacyLink({ originalShareText: null, baiduUrl: null, available: false }),
    ),
    /PINDUODUO_LEGACY_RESOURCE_LINK_MISSING/,
  );
});

test("falls back to the Pinduoduo list link only when no historical title matches", () => {
  const resolved = resolvePinduoduoResource(
    "九月二十四日后的新剧",
    "https://pan.baidu.com/s/full-version",
    undefined,
  );

  assert.deepEqual(resolved, {
    shareText: "https://pan.baidu.com/s/full-version",
    source: "PINDUODUO_LIST",
  });
});

test("generated seed contains the known historical full link and preserves missing-link rows", () => {
  const known = PINDUODUO_LEGACY_RESOURCE_LINKS.find(
    (entry) => entry.normalizedTitle === "果园的天平",
  );

  assert.equal(PINDUODUO_LEGACY_RESOURCE_LINKS.length, 1285);
  assert.equal(PINDUODUO_LEGACY_RESOURCE_LINKS.filter((entry) => entry.available).length, 1279);
  assert.match(known?.originalShareText ?? "", /pan\.baidu\.com\/s\/1_Uie5taISqN-W6bHr3Z-gQ/);
});
