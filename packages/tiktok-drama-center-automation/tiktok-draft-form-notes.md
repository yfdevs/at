# TikTok Drama Center Draft Form Notes

Page: `https://www.tiktokdramacenter.com/series/draft`
Observed: 2026-06-27

## Sections

1. 基础信息
2. 内容上传
3. 剧集详情
4. 商业模式
5. 演员

## Fields

### 基础信息

- 关联合同: required select.
- 剧集名: required text input, placeholder `输入剧集名称`, hint `标题建议不超过 35 个字符`.
- 剧集描述: required textarea, placeholder `概述你的内容，添加精彩细节吸引更多观众`, max counter `1500`.
- 封面图: required file upload, 3:4 ratio, recommended `180x240`, max `10MB`.

### 内容上传

- 正片内容: video upload by drag/drop, `百度网盘上传`, or `本地上传`.
- Video constraints: max 120 videos per series; file size `>= 5 MB` and `<= 4 GB`; duration `>= 15s` and `<= 20min`; recommended MP4; recommended 1080p+, below 720p may affect recommendation; preferred 9:16 vertical.
- 衍生素材: file upload; recommended 9:16 vertical, 1080P+.
- 自动挂载锚点: switch, default observed on.
- Upload dependency hint: page says `请先填写剧名，完成后即可上传视频。`

### 剧集详情

- 目标观众: required select.
- 题材类型: required multi/select.
- 源语言: required select.
- 总集数: required numeric input, suffix `集`.
- 发布账号: required cascader, selected state observed as `StarDrama · 印度尼西亚 +7`.
- 是否 AI 短剧: required select.
- 版权证明 (PDF/Image): file upload, optional-looking label.
- 版权承诺 checkbox: `本人承诺根据事实勾选《版权内容自查清单》的问题，并愿意对任何虚假陈述所造成的后果承担相应责任。`
- 发布方式: required radio: `过审后自动发布` default, `手动发布`, `定时发布`.

### 发布方式 Linkage

- Selecting `定时发布` adds:
  - timezone combobox, default `UTC+8 | 亚洲/北京`
  - datetime input, placeholder `选择发布时间`
  - hint `如果到达定时发布时间但剧集未审核通过，则需要手动发布。`

### 商业模式

- 托管模式: switch, default observed on.
- 定价参考 copy: platform may adjust free/paid settings under hosting; values are references.
- 免费:
  - 个人页剧集展示集数 / 免费预览集数: numeric input with prefix `前`, suffix `集`.
- 付费:
  - 免费预览集数: numeric input, suffix `集`.
  - 预期全集价格设置: price combobox, disabled until the two numeric fields above are filled.
  - Observed option after filling `1` and `1`: `$0.29 每集$0.29`, which updates `用户支付` to `$0.29` and `折扣前预估价格` to `每集$0.29`.

Automation note: multiple radio inputs have DOM `name="default"` across unrelated groups. Do not select radios by `input[name]`; scope by visible section text and label.

### 演员

- Empty state: `暂无演员`.
- Max actor count: 5.
- `添加演员` opens a modal:
  - field `名称`
  - input placeholder `输入名字选择或创建`
- confirm button disabled until a name is selected/created
- copy: `可以选择或新建演员信息，一个剧集下最多 5 个演员`

Observed working flow: click `添加演员`, focus `输入名字选择或创建`, type/search actor name, select an option such as `叶辰 男性 · CN`, then click `确认`.

## End-to-End Dry Run

Observed run from an empty draft on 2026-06-27:

- Filled contract `CT20260618700038`, title, description.
- Uploaded remote cover after converting to `180x240` 3:4 JPG; page showed `替换封面`.
- Selected target audience `女性`, themes `总裁, 都市`, source language `中文`, total episodes `2`, AI short drama `否`.
- Checked the copyright commitment. The drawer opened and required 8 internal checkboxes before `同意` closed it.
- Selected publish mode `手动发布`.
- Filled 商业模式 with `个人页剧集展示集数=1`, paid `免费预览集数=1`, then selected `$0.29 每集$0.29`.
- Added actor `叶辰`.
- Local sample video files in this repo are `0B`, so real video upload validation cannot complete until valid MP4 files are present. The page requirement is `>= 5 MB` and `>= 15s`.

## Option Data

### 合同

Endpoint: `POST /api/content-partner/enterprise/license-contract/list`

- Display: `【明星说（北京）科技有限公司】内容许可协议`
- ID: `CT20260618700038`
- Type: `通用合同`
- Enterprise ID: `7649571407269041173`
- Institution ID: `7649571342307595284`
- Pricing type: `2`
- Regions: `ww`
- Languages: `all`
- Flags: `hasIAA=true`, `hasIAP=true`

Endpoint `POST /api/content-partner/institution/contract/list-not-used` returned an empty list.

### 企业

Endpoint: `POST /api/content-partner/enterprise/general-contract/enterprises`

- Name: `明星说（北京）科技有限公司`
- English name: `MINGXINGSHUO (BEIJING) TECHNOLOGY CO., LTD.`
- Enterprise ID: `7649571407269041173`
- Existing contract ID: `CT20260618700038`
- Country code: `CN`
- Valid signed contract: true

### 目标观众

Endpoint: `GET /api/content-partner/collections/tags?locale=zh-Hans`

- `女性`: tag_val `Female`, id `7473689406390484997`
- `男性`: tag_val `Male`, id `7473689406390403077`

### 题材类型

Endpoint: `GET /api/content-partner/collections/tags?locale=zh-Hans`

Observed labels:

`年龄差`, `Alpha`, `古风`, `虐恋`, `出轨`, `替身`, `商战`, `青春`, `娱乐圈`, `总裁`, `都市`, `头目`, `萌宝`, `年代`, `亲情`, `豪门`, `玄幻`, `禁忌恋`, `大女主`, `闪婚`, `一见钟情`, `将军`, `团宠`, `后宫`, `千金`, `超级英雄`, `马甲`, `神医`, `伦理`, `一夜情`, `扮猪吃虎`, `怀孕`, `总统`, `破镜重圆`, `重逢`, `复仇`, `心动拉扯`, `重生`, `暗恋`, `赘婿`, `异能`, `系统`, `悬疑`, `穿越`, `三角恋`, `逆袭`, `吸血鬼`, `阿尔法狼人`, `职场`

Useful label -> tag_val mapping:

- 年龄差 -> `AgeGap`
- Alpha -> `Alpha`
- 古风 -> `Ancient`
- 虐恋 -> `Angsty Love`
- 出轨 -> `BetrayLove`
- 替身 -> `Body Double`
- 商战 -> `Business Competition`
- 青春 -> `Campus`
- 娱乐圈 -> `Celebrity`
- 总裁 -> `CEO`
- 都市 -> `City`
- 头目 -> `Crime Lord`
- 萌宝 -> `Cute Kids`
- 年代 -> `Decade`
- 亲情 -> `Family`
- 豪门 -> `Family Feud`
- 玄幻 -> `Fantasy`
- 禁忌恋 -> `Fated Lovers`
- 大女主 -> `Female Lead`
- 闪婚 -> `Flash marriage`
- 一见钟情 -> `Flipped`
- 将军 -> `General`
- 团宠 -> `Group Favorite`
- 后宫 -> `Harem`
- 千金 -> `Heiress`
- 超级英雄 -> `Hero`
- 马甲 -> `Hidden Identity`
- 神医 -> `Miracle Doctor`
- 伦理 -> `Morality`
- 一夜情 -> `One-night stand`
- 扮猪吃虎 -> `Playing Dumb`
- 怀孕 -> `Pregnancy`
- 总统 -> `Presient`
- 破镜重圆 -> `Reconciliation`
- 重逢 -> `Reunion`
- 复仇 -> `Revenge`
- 心动拉扯 -> `Romance`
- 重生 -> `Second Chance`
- 暗恋 -> `Secret Love`
- 赘婿 -> `Son-in-Law`
- 异能 -> `Superpowers`
- 系统 -> `System`
- 悬疑 -> `Thriller`
- 穿越 -> `Time Travel`
- 三角恋 -> `Triangle-love`
- 逆袭 -> `Underdog Story`
- 吸血鬼 -> `Vampire`
- 阿尔法狼人 -> `Werewolf`
- 职场 -> `Workplace`

### 源语言

Endpoint: `GET /api/content-partner/tool/language-config/source-languages`

- `英语`: `en`
- `印尼语`: `id`
- `葡语`: `pt`
- `日语`: `ja`
- `泰语`: `th`
- `西语`: `es`
- `韩语`: `ko`
- `土耳其语`: `tr`
- `中文`: `zh`
- `印地语`: `hi`

### 发布账号

Observed cascader countries, each with account `StarDrama`:

- 埃及
- 巴西
- 加拿大
- 美国
- 墨西哥
- 日本
- 沙特阿拉伯
- 印度尼西亚

All 8 were checked in the observed default state, displayed compactly as `StarDrama · 印度尼西亚 +7`.

### 是否 AI 短剧

- `是`
- `否`

Selecting `是` did not add extra fields in the observed UI.

### 演员候选

Observed candidate list in the actor modal:

`叶辰 / 男性 · CN`, `闻涵 / 男性 · CN`, `赵兵 / 男性 · CN`, `王艳 / 女性 · CN`, `何艳秋 / 女性 · CN`, `秦守正 / 男性 · CN`, `夏清苒 / 女性 · CN`, `陶承衍 / 男性 · CN`, `郝砚安 / 女性 · CN`, `郝砚安 / 男性 · CN`, `周冉清 / 女性 · CN`, `彦泽宇 / 男性 · CN`, `夏沐兮 / 女性 · CN`, `谢知衍 / 男性 · CN`, `沈慕言 / 男性 · CN`, `赵佶 / 男性 · CN`, `龙娜 / 女性 · CN`, `顾知夏 / 女性 · CN`, `贺屿川 / 男性 · CN`, `秋婉 / 女性 · CN`, `王烨 / 男性 · CN`, `Sue Man / 女性 · CN`, `Guoguo Chen / 女性 · CN`, `Chen Zhixiong / 男性 · CN`, `Felix Fu / 男性 · CN`, `Lynn Chu / 女性 · CN`, `江清媛 / 女性 · CN`, `沈亦舟 / 男性 · CN`, `祝芍窈 / 男性 · CN`, `米竞桢 / 女性 · CN`, `Marcus / 男性 · US`, `eve / 女性 · US`, `林紫芸 / 女性 · CN`, `洛浩天 / 女性 · CN`, `秦浩宇 / 男性 · CN`, `江晚柠 / 女性 · CN`

## Raw Capture Files

Temporary files from this inspection:

- `/tmp/tiktok_draft_dom.json`
- `/tmp/tiktok_license_contract_list.network-response`
- `/tmp/tiktok_contract_not_used.network-response`
- `/tmp/tiktok_enterprises.network-response`
- `/tmp/tiktok_source_languages.network-response`
- `/tmp/tiktok_tags.network-response`

These temporary captures may include account-specific data. Do not commit cookies or request headers.
