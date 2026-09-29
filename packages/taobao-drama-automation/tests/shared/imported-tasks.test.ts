import assert from "node:assert/strict";
import test from "node:test";

import {
  hasBaiduExtractionCode,
  parseTaobaoWorkbookRows,
} from "../../src/shared/imported-tasks.js";

test("requires a Baidu extraction code before importing a task", () => {
  assert.equal(hasBaiduExtractionCode("https://pan.baidu.com/s/example?pwd=1234"), true);
  assert.equal(hasBaiduExtractionCode("https://pan.baidu.com/s/example 提取码：a1B2"), true);
  assert.equal(hasBaiduExtractionCode("https://pan.baidu.com/s/example"), false);
});

test("imports Taobao tasks from Chinese Excel headers", () => {
  const result = parseTaobaoWorkbookRows("任务.xlsx", [{
    name: "上传清单",
    rows: [
      ["说明", "淘宝批量上传"],
      ["剧名", "百度网盘链接", "集数"],
      ["逆风翻盘", "https://pan.baidu.com/s/example?pwd=1234", "60"],
      ["千集长剧", "https://pan.baidu.com/s/long?pwd=5678", "235"],
      ["错误任务", "https://example.com/video", "0"],
    ],
  }]);

  assert.equal(result.tasks.length, 2);
  assert.deepEqual(result.tasks[0], {
    id: "任务.xlsx:上传清单:3:逆风翻盘",
    originalTitle: "逆风翻盘",
    baiduPanResourceLink: "https://pan.baidu.com/s/example?pwd=1234",
    episodeCount: 60,
    sourceFileName: "任务.xlsx",
    sourceSheet: "上传清单",
    sourceRow: 3,
  });
  assert.equal(result.tasks[1]?.episodeCount, 235);
  assert.equal(result.issues.length, 1);
  assert.match(result.issues[0]!.message, /百度网盘链接/);
  assert.match(result.issues[0]!.message, /1-1000/);
});

test("reports a worksheet that is missing required headers", () => {
  const result = parseTaobaoWorkbookRows("错误.xlsx", [{
    name: "Sheet1",
    rows: [["剧名", "链接"], ["测试剧", "https://pan.baidu.com/s/example"]],
  }]);
  assert.equal(result.tasks.length, 0);
  assert.match(result.issues[0]!.message, /表头/);
});
