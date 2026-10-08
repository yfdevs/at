import assert from "node:assert/strict";
import test from "node:test";

import { selectReusableTaobaoTaskPage } from "../../src/app/runtime.js";

function page(url: string, closed = false) {
  return {
    isClosed: () => closed,
    url: () => url,
  };
}

test("keeps the current Taobao task tab instead of opening another one", () => {
  const current = page("https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish");
  const other = page("https://creator.guanghe.taobao.com/page/workspace/tb");

  assert.equal(selectReusableTaobaoTaskPage([other, current], current), current);
});

test("reuses an existing batch-publish tab when the previous task tab was closed", () => {
  const closed = page("https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish", true);
  const workspace = page("https://creator.guanghe.taobao.com/page/workspace/tb");
  const batch = page(
    "https://creator.guanghe.taobao.com/page/unify/creation-tool/batch-publish" +
      "?ugc_scene=short_drama_multipublish",
  );

  assert.equal(selectReusableTaobaoTaskPage([closed, workspace, batch], closed), batch);
});
