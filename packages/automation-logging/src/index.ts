import { appendFile, mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";

export type AutomationLogLevel = "debug" | "info" | "warn" | "error";
export type AutomationLogFields = Record<string, unknown>;

export type AutomationLogEntry = {
  version: 1;
  time: string;
  level: AutomationLogLevel;
  platform: string;
  scope: string;
  message: string;
  context?: AutomationLogFields;
  details?: AutomationLogFields;
};

export type AutomationLogInput = string | AutomationLogEntry;

export type AutomationLogMethod = {
  (message: string, fields?: AutomationLogFields): void;
  (fields: AutomationLogFields, message: string): void;
};

export type AutomationLogger = {
  debug: AutomationLogMethod;
  info: AutomationLogMethod;
  warn: AutomationLogMethod;
  error: AutomationLogMethod;
  child(options: { scope?: string; context?: AutomationLogFields }): AutomationLogger;
  callback(scope?: string, context?: AutomationLogFields): (message: string) => void;
  flush(): Promise<void>;
};

export type CreateAutomationLoggerOptions = {
  platform: string;
  scope?: string;
  context?: AutomationLogFields;
  logFilePath?: string;
  retentionDays?: number;
  onEntry?: (entry: AutomationLogEntry) => void;
  console?: boolean;
};

const writeQueues = new Map<string, Promise<void>>();
const cleanupKeys = new Set<string>();
const secretKeyPattern = /(authorization|cookie|password|passwd|secret|token|api[-_]?key|webhook)/i;
const legacyPlatformTags = new Set([
  "baidu",
  "baidu-netdisk",
  "baidu-drama",
  "douyin-drama",
  "iqiyi-drama",
  "kuaishou-drama",
  "meituan-drama",
  "pinduoduo-drama",
  "qq-drama",
  "tiktok-drama",
  "wechat-drama",
  "wechat-miniprogram-drama",
]);

const platformLabels: Record<string, string> = {
  "app": "应用",
  "baidu-netdisk": "百度网盘",
  "baidu-drama": "百度短剧",
  "douyin-drama": "抖音短剧",
  "iqiyi-drama": "爱奇艺短剧",
  "kuaishou-drama": "快手短剧",
  "meituan-drama": "美团短剧",
  "pinduoduo-drama": "拼多多短剧",
  "qq-drama": "QQ短剧",
  "tiktok-drama": "TikTok短剧",
  "wechat-drama": "视频号短剧",
  "wechat-miniprogram-drama": "微信小程序短剧",
};

const scopeLabels: Record<string, string> = {
  "account": "账号",
  "api": "接口",
  "auth": "登录",
  "browser": "浏览器",
  "config": "配置",
  "download": "下载",
  "dropdown": "下拉选项",
  "form": "表单",
  "idle-refresh": "空闲刷新",
  "material": "素材",
  "netdisk": "网盘",
  "notification": "通知",
  "publish": "发布",
  "polling": "任务轮询",
  "resources": "素材",
  "runtime": "服务",
  "storage": "存储",
  "submit": "提交",
  "system": "系统",
  "task": "任务",
  "task-api": "任务接口",
  "upload": "上传",
  "video-account-sync": "账号同步",
  "video-transcode": "视频转码",
  "worker": "任务队列",
  "automation": "自动化",
};

const fieldLabels: Record<string, string> = {
  activeUrl: "当前页面",
  accountId: "账号ID",
  accountName: "账号",
  accountProfileName: "配置",
  accountTaskId: "任务ID",
  action: "操作",
  added: "新增",
  attempt: "尝试",
  browserCount: "浏览器",
  busyCount: "处理中",
  channelId: "频道ID",
  count: "数量",
  current: "当前",
  delayMs: "等待",
  dramaId: "剧目ID",
  episodeCount: "集数",
  episode: "集数",
  durationMs: "耗时",
  err: "错误",
  error: "错误",
  errorMessage: "错误",
  expectedCount: "应有数量",
  file: "文件",
  fileCount: "文件数",
  fileName: "文件",
  field: "字段",
  formErrors: "表单错误",
  loginState: "登录状态",
  maxAttempts: "最多尝试",
  maxFileBytes: "大小上限",
  nextPollAt: "下次检查",
  path: "路径",
  platformApplyId: "平台申请ID",
  progress: "进度",
  previewCount: "预览数",
  reason: "原因",
  removed: "移除",
  requesterPlatform: "来源平台",
  resourceName: "剧目",
  status: "状态",
  size: "文件大小",
  taskId: "任务ID",
  taskStatus: "任务状态",
  title: "剧目",
  total: "总数",
  timeoutMinutes: "最长等待",
  url: "地址",
  userDataDir: "账号目录",
  videoAccountId: "视频号ID",
  videoCount: "视频数",
};

const exactMessageTranslations: Record<string, string> = {
  "account task page request": "正在查询账号任务",
  "account task page response": "账号任务查询完成",
  "add-episode confirm clicked": "已确认添加剧集",
  "all task materials ready": "任务素材已准备完成",
  "batch episode upload completed and drawer confirmed": "批量上传剧集完成",
  "batch episode upload started": "开始批量上传剧集",
  "batch upload start episode confirmed: 1": "批量上传起始集数已确认：1",
  "baidu netdisk resource attempt": "正在准备网盘素材",
  "baidu netdisk resource failed after retries": "网盘素材多次重试后仍失败",
  "baidu netdisk resource failed without retry": "网盘素材准备失败，无法重试",
  "baidu netdisk resource failed, retry": "网盘素材准备失败，稍后重试",
  "baidu netdisk resource ready": "网盘素材已就绪",
  "baidu pan resource submitted": "百度网盘素材地址已填写",
  "browser is ready; idle page will remain unchanged while polling": "浏览器已就绪，等待任务",
  "checking due pinduoduo audit records in batch": "正在批量检查到期审核记录",
  "checking shortplay manage row before selecting": "正在检查待选择剧目",
  "checking submitted shortplay apply record": "正在检查已提报剧目",
  "clicking publish-to-collection entry": "正在打开发布到合集入口",
  "claim loop error": "任务领取轮询失败",
  "claim request": "正在领取任务",
  "claim response": "任务领取请求完成",
  "claimed account task": "任务领取成功",
  "claimed pinduoduo drama task, submitting shortplay apply edit": "已领取任务，开始提报剧目",
  "cleared stale active task lock": "已清理失效的任务锁",
  "clicked confirm after upload prompt": "已确认上传提示",
  "content management locator click failed, retrying in dom": "内容管理入口点击失败，正在重试",
  "confirming collection drawer": "正在确认合集信息",
  "credential snapshot saved": "登录状态已保存",
  "download scan queued oversized episode video": "发现超限视频，已加入转码队列",
  "download-time episode transcode failed; final preparation will retry": "下载时转码失败，将在发布前重试",
  "draft form not visible; opening draft page": "发布表单未显示，正在打开草稿页",
  "draft ready; claiming task": "草稿页已就绪，正在领取任务",
  "ensure baidu netdisk resource before task": "发布前正在准备网盘素材",
  "episode videos prepared": "剧集视频已准备完成",
  "fail callback completed": "任务失败结果已上报",
  "fail callback request": "正在上报任务失败结果",
  "fail callback response": "任务失败结果上报请求完成",
  "failed to open draft page; will retry": "打开草稿页失败，准备重试",
  "failed to open shortplay manage page": "打开短剧管理页失败",
  "failed to refresh shortplay manage pending list": "刷新待提报列表失败",
  "failed to report shortplay apply edit error": "提报失败结果上报失败",
  "failed to run pinduoduo drama task loop tick": "任务轮询失败",
  "failed to start google chrome channel": "启动 Chrome 浏览器失败",
  "failed to submit shortplay apply edit": "剧目提报失败",
  "fetching scheme": "正在获取任务方案",
  "fetching submitted shortplay apply records by api": "正在查询已提报剧目",
  "filling average episode duration": "正在填写平均单集时长",
  "filling broadcast info": "正在填写播出信息",
  "filling broadcast rows": "正在填写播出记录",
  "filling drama summary": "正在填写剧情简介",
  "filling expected premiere time": "正在填写预计首播时间",
  "filling main actor info": "正在填写主演信息",
  "filling other-platform premiere date": "正在填写其他平台首播日期",
  "filling personnel info": "正在填写人员信息",
  "filling plot synopsis": "正在填写剧情简介",
  "filling production company": "正在填写制作公司",
  "filling production cost and episode duration": "正在填写制作成本与单集时长",
  "filling production organization": "正在填写制作机构",
  "filling publish variants one at a time": "正在依次填写发布版本",
  "filling total episodes": "正在填写总集数",
  "form filled": "表单填写完成",
  "form validation failed": "表单校验失败",
  "full-paid form completed; opening ad-unlock form": "付费版表单已完成，正在打开广告解锁版",
  "initialized video accounts": "视频号账号初始化完成",
  "login is required before opening shortplay manage page": "需要登录后才能打开短剧管理页",
  "login is still required after reopening shortplay manage page": "重新打开短剧管理页后仍需登录",
  "login confirmed, edit form is ready": "登录成功，编辑表单已就绪",
  "login required, waiting for authenticated edit form": "需要登录，请登录后继续填写",
  "login required; waiting for login before claiming task": "需要登录，请登录后再领取任务",
  "manual login completed, shortplay manage page reopened": "登录成功，短剧管理页已重新打开",
  "manual login detected, reopening shortplay manage page": "检测到登录成功，正在重新打开短剧管理页",
  "mock account task page response": "模拟任务查询完成",
  "mock claimed account task": "模拟任务领取成功",
  "mock fail callback skipped": "模拟模式已跳过失败上报",
  "mock success callback skipped": "模拟模式已跳过成功上报",
  "next step clicked; waiting for submission confirmation": "已进入下一步，等待提交确认",
  "no claimable account task": "暂无待处理任务",
  "no pinduoduo drama task to run": "暂无待处理任务",
  "no tiktok drama task claimed": "暂无待处理任务",
  "opened pinduoduo content management page": "拼多多内容管理页已打开",
  "opening pinduoduo creator management list": "正在打开拼多多创作者管理列表",
  "opening publish page": "正在打开发布页面",
  "opening edit page in dedicated task tab": "正在独立任务页打开编辑页面",
  "opening edit page; task polling starts after login": "正在打开编辑页面，登录后开始领取任务",
  "opening shortplay manage page": "正在打开短剧管理页",
  "pinduoduo content management page opened": "拼多多内容管理页已打开",
  "pinduoduo contract file downloaded": "合同文件已下载",
  "pinduoduo contract files uploaded": "合同文件已上传",
  "pinduoduo contract upload missing required contract urls": "缺少必需的合同文件地址",
  "pinduoduo contract upload previews completed in ui": "合同上传预览已完成",
  "pinduoduo drama task loop sleeping": "任务轮询等待中",
  "pinduoduo shortplay submit failed with platform toast": "平台提示剧目提审失败",
  "prepared task entered publish stage": "素材准备完成，进入发布阶段",
  "preparing local episode videos": "正在准备本地剧集视频",
  "paid drama service agreement accepted": "已同意付费短剧服务协议",
  "post-submit wait completed": "提交后等待完成",
  "processing approved pinduoduo shortplay upload queue": "正在处理审核通过的剧目队列",
  "purchasemode skipped: this page version no longer shows purchase radios in 商业模式": "当前页面无需选择购买模式，已跳过",
  "queued claimed task": "已领取任务加入队列",
  "queued manual task": "手动任务已加入队列",
  "refresh failed": "页面刷新失败",
  "refreshing shortplay manage pending list by switching tabs": "正在刷新待提报列表",
  "registered active account task": "任务已进入处理中",
  "released active account task": "任务处理占用已释放",
  "released channel reservation": "账号占用已释放",
  "reserved channel": "账号已占用",
  "reserved pinduoduo approved shortplay flow reached content management page": "审核通过的剧目已进入内容管理页",
  "selected account task": "已选择待处理任务",
  "selecting author": "正在选择作者",
  "selecting background": "正在选择故事背景",
  "selecting checkpoint episodes": "正在选择付费节点集数",
  "selecting collection": "正在选择合集",
  "selecting completion status": "正在选择完结状态",
  "selecting content categories": "正在选择内容分类",
  "selecting content channel": "正在选择内容频道",
  "selecting content type": "正在选择内容类型",
  "selecting copyright materials": "正在选择版权材料",
  "selecting copyright proof type": "正在选择版权证明类型",
  "selecting directors": "正在选择导演",
  "selecting full scene display": "正在选择全场景展示",
  "selecting plot settings": "正在选择剧情设定",
  "selecting plot tags": "正在选择剧情标签",
  "selecting premiere status": "正在选择首播状态",
  "selecting producers": "正在选择制片人",
  "selecting production method": "正在选择制作方式",
  "selecting production year": "正在选择制作年份",
  "selecting record number status": "正在选择备案号状态",
  "selecting screenwriters": "正在选择编剧",
  "selecting special subject status": "正在选择特殊题材状态",
  "selecting story theme": "正在选择故事主题",
  "selecting sublicensing right": "正在选择转授权权限",
  "selected shortplays submitted for audit": "所选剧目已提交审核",
  "send failed": "通知发送失败",
  "shortplay apply edit request": "正在提报剧目",
  "shortplay apply edit submitted": "剧目提报完成",
  "shortplay apply list response detected after tab click": "切换列表后已获取剧目数据",
  "shortplay apply list response was not detected after tab click": "切换列表后未获取到剧目数据",
  "shortplay manage page opened": "短剧管理页已打开",
  "shortplay manage pending list refreshed": "待提报列表已刷新",
  "shortplay manage row checkbox was not found": "未找到剧目选择框",
  "shortplay manage row is ready for selecting": "剧目已可选择",
  "shortplay manage row selected": "剧目已选择",
  "shortplay manage row title found, waiting before selecting": "已找到剧目，等待页面稳定",
  "shortplay manage row title was not found": "未找到目标剧目",
  "shortplay manage tab active state was not detected": "未确认短剧列表切换成功",
  "shortplay manage tab clicked": "短剧列表已切换",
  "shortplay manage tab dom click dispatched": "已通过页面脚本切换短剧列表",
  "shortplay manage tab playwright click failed": "短剧列表点击失败",
  "skip busy channel": "账号正在使用，已跳过",
  "skip claim, login required": "账号需要登录，已暂停领取任务",
  "skip cooling account tasks": "冷却中的账号任务已跳过",
  "skip duplicate claimed account task": "重复领取的任务已跳过",
  "started": "服务已启动",
  "started browser with google chrome channel": "浏览器已启动",
  "starting reserved pinduoduo approved shortplay flow": "开始处理审核通过的剧目",
  "starting account browser": "正在启动账号浏览器",
  "starting task": "开始处理任务",
  "stopped": "服务已停止",
  "stopped removed channel": "已停止移除账号的刷新任务",
  "stopping": "正在停止服务",
  "stopping removed worker": "正在停止已移除账号的任务队列",
  "submitted shortplay apply record checked": "已提报剧目检查完成",
  "submitted shortplay apply records fetched by api": "已提报剧目查询完成",
  "submission confirmation clicked; waiting for url step=1": "已确认提交，等待页面返回编辑步骤",
  "submitting selected shortplays for audit": "正在提交所选剧目审核",
  "success callback completed": "任务成功结果已上报",
  "success callback request": "正在上报任务成功结果",
  "success callback response": "任务成功结果上报请求完成",
  "sync failed": "账号同步失败",
  "synced video accounts": "视频号账号同步完成",
  "task failed": "任务失败",
  "task failed before browser was ready": "浏览器就绪前任务失败",
  "task failed, pipeline continues": "任务失败，队列继续运行",
  "task finished without submit": "任务处理完成，未执行提交",
  "task interrupted": "任务已中断",
  "task interrupted, skip failure callback": "任务已中断，跳过失败上报",
  "task started": "任务开始处理",
  "task submitted": "任务已提交",
  "claimed task": "任务领取成功",
  "task succeeded": "任务已完成",
  "toast confirmed": "已确认页面提示",
  "toast error": "页面提示操作失败",
  "setting copyright validity range": "正在设置版权有效期",
  "uploading authorization promotion file": "正在上传授权推广材料",
  "uploading copyright declaration file": "正在上传版权声明材料",
  "uploading drama cover": "正在上传剧目封面",
  "uploading premiere proof": "正在上传首播证明",
  "video account loaded": "视频号账号已加载",
  "video accounts changed": "视频号账号已更新",
  "video upload finished": "视频上传完成",
  "video upload progress": "视频上传进度",
  "video upload skipped because task has no local video files": "任务没有本地视频，已跳过上传",
  "video upload started": "开始上传视频",
  "video files missing; skipping video upload for fake task": "未找到视频文件，测试任务已跳过上传",
  "waiting for manual login before claiming tasks": "需要登录，请登录后再领取任务",
  "waiting for stopped worker before restarting": "正在等待旧任务队列停止",
  "worker started": "任务队列已启动",
  "worker stopped": "任务队列已停止",
  "browser kept open; press ctrl+c to exit": "浏览器保持打开，按 Ctrl+C 退出",
  "using persistent browser profile": "正在使用持久化浏览器账号",
};

export function createAutomationLogger(
  options: CreateAutomationLoggerOptions,
): AutomationLogger {
  const write = (
    level: AutomationLogLevel,
    scope: string,
    context: AutomationLogFields,
    first: string | AutomationLogFields,
    second?: string | AutomationLogFields,
  ) => {
    const { message: rawMessage, fields } = resolveLogArguments(first, second);
    const parsed = parseLegacyMessage(rawMessage, scope);
    const message = normalizeMessage(parsed.message);
    const safeContext = redactFields(context);
    const safeDetails = redactFields(fields);
    const entry: AutomationLogEntry = {
      version: 1,
      time: formatLocalDateTime(new Date()),
      level,
      platform: options.platform,
      scope: inferScope(parsed.scope, message),
      message,
      ...(Object.keys(safeContext).length ? { context: safeContext } : {}),
      ...(Object.keys(safeDetails).length ? { details: safeDetails } : {}),
    };

    try {
      options.onEntry?.(entry);
    } catch {
      // One unavailable sink must not block the remaining sinks.
    }
    try {
      if (options.console) writeConsole(entry);
    } catch {
      // Logging is observational and must never change an automation result.
    }
    try {
      if (options.logFilePath) enqueueEntry(options.logFilePath, entry, options.retentionDays ?? 3);
    } catch {
      // Logging is observational and must never change an automation result.
    }
  };

  const build = (scope: string, context: AutomationLogFields): AutomationLogger => ({
    debug: (first, second) => write("debug", scope, context, first, second),
    info: (first, second) => write("info", scope, context, first, second),
    warn: (first, second) => write("warn", scope, context, first, second),
    error: (first, second) => write("error", scope, context, first, second),
    child(childOptions) {
      return build(
        childOptions.scope ?? scope,
        { ...context, ...childOptions.context },
      );
    },
    callback(callbackScope = scope, callbackContext = {}) {
      return (message) => write(
        levelFromLegacyMessage(message),
        callbackScope,
        { ...context, ...callbackContext },
        message,
      );
    },
    async flush() {
      if (!options.logFilePath) return;
      await Promise.all([
        writeQueues.get(readableLogFile(options.logFilePath)),
        writeQueues.get(structuredLogFile(options.logFilePath)),
      ].filter((queue): queue is Promise<void> => Boolean(queue)));
    },
  });

  return build(options.scope ?? "runtime", options.context ?? {});
}

export function normalizeAutomationLogInput(
  input: AutomationLogInput,
  fallback: Pick<AutomationLogEntry, "platform" | "scope">,
): AutomationLogEntry {
  if (typeof input !== "string") return input;
  const parsed = parseLegacyMessage(input, fallback.scope);
  return {
    version: 1,
    time: formatLocalDateTime(new Date()),
    level: levelFromLegacyMessage(input),
    platform: fallback.platform,
    scope: parsed.scope,
    message: normalizeMessage(parsed.message),
  };
}

export function formatReadableLogEntry(entry: AutomationLogEntry) {
  const level = {
    debug: "调试",
    info: "信息",
    warn: "提醒",
    error: "错误",
  }[entry.level];
  const platform = platformLabels[entry.platform] ?? entry.platform;
  const scope = scopeLabels[entry.scope] ?? entry.scope;
  const fields = { ...entry.context, ...entry.details };
  const detail = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${fieldLabels[key] ?? key}=${formatFieldValue(key, value)}`)
    .join(" · ");
  return `${entry.time} [${level}] [${platform}/${scope}] ${entry.message}${detail ? ` | ${detail}` : ""}`;
}

export function formatDateKey(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function resolveLogArguments(
  first: string | AutomationLogFields,
  second?: string | AutomationLogFields,
) {
  if (typeof first === "string") {
    return {
      message: first,
      fields: typeof second === "object" && second ? second : {},
    };
  }
  return {
    message: typeof second === "string" ? second : "记录运行信息",
    fields: first,
  };
}

function parseLegacyMessage(message: string, fallbackScope: string) {
  let remaining = message.trim();
  let scope = fallbackScope;
  for (;;) {
    const match = /^\[([^\]]+)]\s*/.exec(remaining);
    if (!match) break;
    const tag = match[1].trim().toLowerCase();
    const mappedScope = scopeFromLegacyTag(tag);
    if (!legacyPlatformTags.has(tag) && !mappedScope) break;
    if (mappedScope) scope = mappedScope;
    remaining = remaining.slice(match[0].length).trim();
  }
  return { scope, message: remaining || "记录运行信息" };
}

function scopeFromLegacyTag(tag: string) {
  if (/^(account|api|auth|browser|config|download|form|material|notification|publish|runtime|storage|submit|system|task|upload|worker)$/.test(tag)) return tag;
  if (/^(task-api|idle-refresh|video-account-sync|video-transcode|resources|automation|polling|dropdown)$/.test(tag)) return tag;
  if (/^(baidu|baidu-transfer|disk-cleanup)$/.test(tag)) return "netdisk";
  if (/^(download|video-transcode.*)$/.test(tag)) return "download";
  if (/^(video-assets|material|poster)$/.test(tag)) return "material";
  if (/^(poster-material-invalid|image-compress-failed|local-video-invalid|production-proof-invalid)$/.test(tag)) return "material";
  if (/^(video-transcode-cancelled|video-transcode-failed)$/.test(tag)) return "video-transcode";
  if (/^(upload.*|vod.*)$/.test(tag)) return "upload";
  if (/^(login|check)$/.test(tag)) return "auth";
  if (/^(fill|form)$/.test(tag)) return "form";
  if (/^(task|step|retry|step-timeout)$/.test(tag)) return "task";
  if (/^(submit|action|wait)$/.test(tag)) return "submit";
  if (/^(browser|idle-refresh)$/.test(tag)) return "browser";
  if (/^(config)$/.test(tag)) return "config";
  if (/^(skip|warn|debug)$/.test(tag)) return fallbackScopeFromTag(tag);
  return undefined;
}

function fallbackScopeFromTag(tag: string) {
  return tag === "debug" ? "system" : "runtime";
}

function levelFromLegacyMessage(message: string): AutomationLogLevel {
  if (/\bfatal\b|阻断性/i.test(message)) return "error";
  if (/^\[(warn|skip|retry)]/i.test(message) || /\b(retry|retrying|fallback|skipped|timeout|warning|rejected)\b|重试|跳过|超时|警告|拒绝/i.test(message)) return "warn";
  if (/\b(failed|failure|error|失败|异常|错误)\b/i.test(message)) return "error";
  return "info";
}

function normalizeMessage(message: string) {
  const source = message.trim();
  const lookupKey = source.replace(/[.。]+$/, "").toLowerCase();
  const normalized = (exactMessageTranslations[lookupKey] ?? source)
    .replace(/^starting browser$/i, "正在启动浏览器")
    .replace(/^runtime stopped[。.]?$/i, "服务已停止")
    .replace(/^all account browsers stopped[。.]?$/i, "全部账号浏览器已停止")
    .replace(/^polling for next task[。.]?$/i, "正在检查新任务")
    .replace(/^no (claimable )?task(?: claimed)?[。.]?$/i, "暂无待处理任务")
    .replace(/^login required,? waiting for manual login[。.]?$/i, "需要登录，请在浏览器中完成登录")
    .replace(/^waiting for login[。.]?$/i, "请在浏览器中完成登录")
    .replace(/^login completed[。.]?$/i, "登录成功")
    .replace(/^already logged in[。.]?$/i, "账号已登录")
    .replace(/^credential (snapshot|state) saved:\s*/i, "登录状态已保存：")
    .replace(/^task succeeded:\s*/i, "任务已完成：")
    .replace(/^task failed:\s*/i, "任务失败：")
    .replace(/^task report retry\s*/i, "任务结果上报重试 ")
    .replace(/^task error report failed:\s*/i, "任务失败结果上报失败：")
    .replace(/^task loop tick failed:\s*/i, "任务轮询失败：")
    .replace(/^task report failed,? retrying:\s*/i, "任务结果上报失败，准备重试：")
    .replace(/^fail callback failed:\s*/i, "任务失败结果上报失败：")
    .replace(/^task claim failed:\s*/i, "领取任务失败：")
    .replace(/^publish succeeded but success callback failed:\s*/i, "发布成功，但结果上报失败：")
    .replace(/^invalid claimed task report failed:\s*/i, "无效任务结果上报失败：")
    .replace(/^fetched\s+(\d+)\s+READY task\(s\)/i, "发现 $1 个待处理任务")
    .replace(/^claimed task:\s*/i, "已领取任务：")
    .replace(/^task finished:\s*/i, "任务已完成：")
    .replace(/^starting claimed task:\s*/i, "开始处理任务：")
    .replace(/^start basic info step:\s*/i, "开始填写基本信息：")
    .replace(/^start episode upload step:\s*/i, "开始上传剧集：")
    .replace(/^start confirm step:\s*/i, "开始确认提交：")
    .replace(/^browser preparation failed:\s*/i, "浏览器准备失败：")
    .replace(/^failed to open add page:\s*/i, "打开新建页面失败：")
    .replace(/^initial page failed:\s*/i, "打开初始页面失败：")
    .replace(/^login wait failed:\s*/i, "等待登录失败：")
    .replace(/^started browser with Playwright Chromium$/i, "浏览器已启动")
    .replace(/^starting browser:\s*/i, "正在启动浏览器：")
    .replace(/^opened dedicated task tab:\s*/i, "已打开任务页：")
    .replace(/^opened dedicated task page:\s*/i, "已打开任务页：")
    .replace(/^kept dedicated task page:\s*/i, "任务页保持打开：")
    .replace(/^closed dedicated task tab:\s*/i, "已关闭任务页：")
    .replace(/^closed dedicated task page:\s*/i, "已关闭任务页：")
    .replace(/^opening add page for\s*/i, "正在打开新建页面：")
    .replace(/^local cover and poster ready:\s*/i, "封面与海报已准备：")
    .replace(/^local (collection )?cover ready:\s*/i, "本地封面已准备：")
    .replace(/^AI configuration is unavailable; using the original cover for ad-unlock$/i, "AI 未配置，广告解锁版将使用原始封面")
    .replace(/^reused AI landscape cover cache:\s*/i, "已复用 AI 横图缓存：")
    .replace(/^generating landscape cover with AI model=\s*/i, "正在生成 AI 横图，模型=")
    .replace(/^AI landscape cover ready:\s*/i, "AI 横图已准备：")
    .replace(/^ad cover AI cache hit:\s*/i, "已复用广告封面缓存：")
    .replace(/^analyzing ad cover with AI:\s*/i, "正在分析广告封面：")
    .replace(/^ad cover AI coordinates:\s*/i, "广告封面裁剪区域：")
    .replace(/^ad cover AI result rejected,? retrying:\s*/i, "广告封面分析结果不可用，准备重试：")
    .replace(/^ad-unlock AI cover ready:\s*/i, "广告解锁版封面已准备：")
    .replace(/^task has no baidu netdisk resource; download check skipped$/i, "任务未配置网盘素材，已跳过下载")
    .replace(/^ensuring baidu netdisk resource(?::\s*)?/i, "正在准备网盘素材：")
    .replace(/^baidu netdisk resource ready(?::\s*)?/i, "网盘素材已就绪：")
    .replace(/^baidu netdisk resource failed,? retrying(?::\s*)?/i, "网盘素材准备失败，稍后重试：")
    .replace(/^downloading cover and ownership materials$/i, "正在下载封面与权属材料")
    .replace(/^waiting for ownership directory download$/i, "正在等待权属材料下载")
    .replace(/^preparing copyright proof materials$/i, "正在准备版权材料")
    .replace(/^validating local episode videos before publishing$/i, "正在检查本地剧集文件")
    .replace(/^matching local collection cover before publishing$/i, "正在匹配本地封面")
    .replace(/^episode upload status:\s*/i, "剧集上传进度：")
    .replace(/^video upload progress:\s*/i, "视频上传进度：")
    .replace(/^video upload success:\s*/i, "视频上传成功：")
    .replace(/^all\s+(\d+)\s+episode video\(s\) uploaded$/i, "$1 集视频全部上传完成")
    .replace(/^uploading\s+(\d+)\s+episode video\(s\)$/i, "正在上传 $1 集视频")
    .replace(/^episode video files submitted$/i, "剧集视频已提交上传")
    .replace(/^add-episode dialog visible:\s*missing=/i, "添加剧集窗口已打开，缺少集数=")
    .replace(/^add-episode count entered:\s*/i, "已填写新增集数：")
    .replace(/^episode slots created:\s*/i, "剧集槽位已创建：")
    .replace(/^selecting sale mode:\s*/i, "正在选择售卖模式：")
    .replace(/^creating\s+(\d+)\s+episode slots:\s*/i, "正在创建 $1 个剧集槽位：")
    .replace(/^retrying failed episode:\s*/i, "剧集上传失败，准备重试：")
    .replace(/^waiting for upload UI confirmation:\s*/i, "正在等待页面确认上传：")
    .replace(/^upload UI confirmed:\s*/i, "页面已确认上传：")
    .replace(/^review submitted:\s*/i, "已提交审核：")
    .replace(/^collection completed; continuing to video upload$/i, "合集信息已完成，继续上传视频")
    .replace(/^collection cover accepted without crop dialog$/i, "合集封面已上传，无需裁剪")
    .replace(/^submit and review button clicked$/i, "已点击提交审核")
    .replace(/^submit confirmation button clicked$/i, "已确认提交")
    .replace(/^submitting publish form$/i, "正在提交发布表单")
    .replace(/^expected premiere time received:\s*/i, "已获取预计首播时间：")
    .replace(/^other-platform premiere date received:\s*/i, "已获取其他平台首播日期：")
    .replace(/^confirmed\s+(.+?)\s+crop dialog$/i, "已确认 $1 裁剪")
    .replace(/^(.+?)\s+upload confirmed$/i, "$1 上传已确认")
    .replace(/^(.+?)\s+upload rejected by page:\s*/i, "$1 上传被页面拒绝：")
    .replace(/^main actor target count:\s*/i, "主演人数：")
    .replace(/^clicking add main actor for row\s*/i, "正在添加主演行：")
    .replace(/^added main actor row\s*/i, "已添加主演行：")
    .replace(/^main actor filled:\s*/i, "主演填写进度：")
    .replace(/^main actor section completed:\s*/i, "主演信息填写完成：")
    .replace(/^author declaration already selected:\s*/i, "作者声明已选择：")
    .replace(/^author declaration field ready:\s*/i, "作者声明字段已就绪：")
    .replace(/^author declaration selected:\s*/i, "作者声明已选择：")
    .replace(/^selecting author declaration:\s*/i, "正在选择作者声明：")
    .replace(/^adding broadcast row\s*/i, "正在添加播出记录：")
    .replace(/^filling broadcast row\s*/i, "正在填写播出记录：")
    .replace(/^broadcast fast fill fallback:\s*/i, "播出信息快捷填写失败，已降级：")
    .replace(/^personnel fast fill fallback:\s*/i, "人员信息快捷填写失败，已降级：")
    .replace(/^production metrics fast fill fallback:\s*/i, "制作指标快捷填写失败，已降级：")
    .replace(/^production organization fast fill fallback:\s*/i, "制作机构快捷填写失败，已降级：")
    .replace(/^filling drama title:\s*/i, "正在填写剧名：")
    .replace(/^edit form fields completed:\s*/i, "编辑表单填写完成：")
    .replace(/^tab started:\s*/i, "开始填写版本：")
    .replace(/^tab completed:\s*/i, "版本填写完成：")
    .replace(/^tab failed:\s*/i, "版本填写失败：")
    .replace(/^(.+?)\s+downloaded:\s*/i, "$1 已下载：")
    .replace(/^(.+?)\s+materialized from package asset:\s*/i, "$1 已从内置素材准备：")
    .replace(/^(.+?)\s+using local file:\s*/i, "$1 使用本地文件：")
    .replace(/^video upload step entered:\s*/i, "已进入视频上传步骤：")
    .replace(/^waiting for batch upload:\s*timeout=(\d+)\s*minutes$/i, "正在等待批量上传，最长 $1 分钟")
    .replace(/^batch episode upload status:\s*/i, "批量上传进度：")
    .replace(/^fatal warning captured:\s*/i, "检测到阻断性提示：")
    .replace(/^account worker stopped with error:\s*/i, "账号任务队列异常停止：")
    .replace(/^started\s+(\d+)\s+account browser\(s\)$/i, "已启动 $1 个账号浏览器")
    .replace(/^ready task query failed,? retrying in 10s:\s*/i, "待处理任务查询失败，10 秒后重试：")
    .replace(/^fetched\s+(\d+)\s+READY task\(s\),? claiming sequentially$/i, "发现 $1 个待处理任务，正在依次领取")
    .replace(/^task already unavailable after claim:\s*/i, "任务领取后已不可用：")
    .replace(/^task succeeded and reported:\s*/i, "任务已完成并上报：")
    .replace(/^create collection drawer did not open,? retrying:\s*/i, "合集创建窗口未打开，准备重试：")
    .replace(/^clicked project action:\s*/i, "已执行项目操作：")
    .replace(/^filling field:\s*/i, "正在填写字段：")
    .replace(/^clicking button:\s*/i, "正在点击按钮：")
    .replace(/^filling\s+(.+)/i, "正在填写：$1")
    .replace(/^selecting\s+(.+)/i, "正在选择：$1")
    .replace(/^uploading\s+(\d+)\s+file\(s\):\s*/i, "正在上传 $1 个文件：")
    .replace(/^uploading file:\s*/i, "正在上传文件：")
    .replace(/^uploading\s+(.+)/i, "正在上传：$1")
    .replace(/^preparing\s+(.+)/i, "正在准备：$1")
    .replace(/^opening\s+(.+)/i, "正在打开：$1")
    .replace(/^creating\s+(.+)/i, "正在创建：$1")
    .replace(/^waiting for\s+(.+)/i, "正在等待：$1")
    .replace(/^clicking\s+(.+)/i, "正在点击：$1")
    .replace(/^added\s+(.+)/i, "已添加：$1")
    .replace(/^confirmed\s+(.+)/i, "已确认：$1")
    .replace(/^completed\s+(.+)/i, "已完成：$1")
    .replace(/^(.+?)\s+completed$/i, "$1 已完成")
    .replace(/^(.+?)\s+ready:\s*/i, "$1 已准备：")
    .replace(/^(.+?)\s+ready$/i, "$1 已准备完成")
    .replace(/^(.+?)\s+accepted without crop dialog$/i, "$1 已上传，无需裁剪")
    .replace(/^(.+?)\s+accepted$/i, "$1 已确认")
    .replace(/^reused\s+(.+)/i, "已复用：$1")
    .replace(/^generating\s+(.+)/i, "正在生成：$1")
    .replace(/^no claimable task; idle page left unchanged$/i, "暂无待处理任务")
    .replace(/^claimed task not provided, browser is ready$/i, "浏览器已就绪，等待任务")
    .replace(/^publish task completed$/i, "发布任务已完成")
    .replace(/^download check skipped[。.]?$/i, "已跳过下载检查")
    .replace(/\bsubmit=false\b/gi, "未启用提交")
    .replace(/\bfull-paid\b/gi, "付费版")
    .replace(/\bad-unlock\b/gi, "广告解锁版")
    .replace(/\baccountTaskId=/gi, "任务ID=")
    .replace(/\buserDataDir=/gi, "账号目录=")
    .replace(/\boriginalTitle=/gi, "原剧名=")
    .replace(/\bfiles=/gi, "文件数=")
    .replace(/\bmissing=/gi, "缺少=")
    .replace(/\battempt=/gi, "尝试=")
    .replace(/\bcurrent=/gi, "当前=")
    .replace(/\breadonly=/gi, "只读=")
    .replace(/\brows visible\b/gi, "行可见")
    .replace(/\bunknown\b/gi, "未知")
    .trim();
  return normalized.replace(/[.。]+$/, "");
}

function inferScope(scope: string, message: string) {
  if (scope !== "runtime" && scope !== "system") return scope;
  if (/登录|账号已登录|扫码|login|credential/i.test(message)) return "auth";
  if (/浏览器|页面|browser|tab\b/i.test(message)) return "browser";
  if (/网盘|下载|转存|netdisk|download/i.test(message)) return "netdisk";
  if (/封面|海报|权属|版权|素材|制作证明|cover|poster|material/i.test(message)) return "material";
  if (/上传|upload|VOD/i.test(message)) return "upload";
  if (/提交|提审|审核|submit|review/i.test(message)) return "submit";
  if (/填写|字段|选择|按钮|表单|角色|价格|fill|select|field|form|actor|price/i.test(message)) return "form";
  if (/接口|回调|上报|API/i.test(message)) return "api";
  if (/任务|领取|轮询|task|claim|poll/i.test(message)) return "task";
  return scope;
}

function formatLocalDateTime(date: Date) {
  const time = [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ].join(":");
  return `${formatDateKey(date)} ${time}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function redactFields(fields: AutomationLogFields): AutomationLogFields {
  return Object.fromEntries(Object.entries(fields).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return [[key, secretKeyPattern.test(key) ? "[已隐藏]" : redactValue(value, 0)]];
  }));
}

function redactValue(value: unknown, depth: number): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === "string") return value.length > 4_000 ? `${value.slice(0, 4_000)}…` : value;
  if (typeof value === "bigint" || typeof value === "symbol" || typeof value === "function") return String(value);
  if (!value || typeof value !== "object") return value;
  if (depth >= 4) return "[内容过深]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactValue(item, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    secretKeyPattern.test(key) ? "[已隐藏]" : redactValue(item, depth + 1),
  ]));
}

function formatFieldValue(key: string, value: unknown) {
  if (value instanceof Error) return normalizeMessage(parseLegacyMessage(value.message, "system").message);
  if (typeof value === "string") {
    const displayValue = /(?:error|message)$/i.test(key)
      ? normalizeMessage(parseLegacyMessage(value, "system").message)
      : value;
    return displayValue.replace(/\s+/g, " ").slice(0, 500);
  }
  if (typeof value === "number") {
    if (key === "timeoutMinutes") return `${value}分钟`;
    if (key === "size" || /Bytes$/.test(key)) return formatByteSize(value);
    return /(?:duration|delay|elapsed|interval|timeout).*ms$/i.test(key) || /Ms$/.test(key)
      ? `${value}ms`
      : String(value);
  }
  if (typeof value === "boolean" || value === null) return String(value);
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string") {
      return normalizeMessage(parseLegacyMessage(message, "system").message)
        .replace(/\s+/g, " ")
        .slice(0, 500);
    }
  }
  try {
    return JSON.stringify(value).slice(0, 500);
  } catch {
    return String(value).slice(0, 500);
  }
}

function formatByteSize(value: number) {
  if (!Number.isFinite(value) || value < 1_024) return `${value}B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)}KB`;
  if (value < 1_024 * 1_024 * 1_024) return `${(value / 1_024 / 1_024).toFixed(1)}MB`;
  return `${(value / 1_024 / 1_024 / 1_024).toFixed(1)}GB`;
}

function readableLogFile(configuredPath: string) {
  return configuredPath.replace(/\.(?:jsonl|log)$/i, ".log");
}

function structuredLogFile(configuredPath: string) {
  const readablePath = readableLogFile(configuredPath);
  return path.join(
    path.dirname(readablePath),
    "structured",
    `${path.basename(readablePath, ".log")}.jsonl`,
  );
}

function enqueueEntry(configuredPath: string, entry: AutomationLogEntry, retentionDays: number) {
  const readablePath = readableLogFile(configuredPath);
  const structuredPath = structuredLogFile(configuredPath);
  void cleanupAutomationLogFiles(readablePath, retentionDays).catch(() => undefined);
  enqueueWrite(readablePath, `${formatReadableLogEntry(entry)}\n`);
  enqueueWrite(structuredPath, `${JSON.stringify(entry)}\n`);
}

function enqueueWrite(filePath: string, content: string) {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await appendFile(filePath, content, "utf8");
    })
    .catch(() => undefined);
  writeQueues.set(filePath, next);
  void next.finally(() => {
    if (writeQueues.get(filePath) === next) writeQueues.delete(filePath);
  });
}

export async function cleanupAutomationLogFiles(configuredPath: string, retentionDays = 3) {
  const logDir = path.dirname(readableLogFile(configuredPath));
  const key = `${logDir}:${formatDateKey()}`;
  if (cleanupKeys.has(key)) return;
  cleanupKeys.add(key);
  const cutoff = Date.now() - Math.max(1, retentionDays) * 24 * 60 * 60 * 1_000;
  await Promise.all([logDir, path.join(logDir, "structured")].map(async (dir) => {
    await mkdir(dir, { recursive: true });
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isFile() || !/^app(?:-.+)?-\d{4}-\d{2}-\d{2}\.(?:jsonl|log)$/i.test(entry.name)) continue;
      const filePath = path.join(dir, entry.name);
      const fileStat = await stat(filePath).catch(() => undefined);
      if (fileStat && fileStat.mtimeMs < cutoff) await unlink(filePath).catch(() => undefined);
    }
  }));
}

function writeConsole(entry: AutomationLogEntry) {
  const line = formatReadableLogEntry(entry);
  try {
    if (entry.level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  } catch {
    // Ignore closed or unavailable output streams.
  }
}
