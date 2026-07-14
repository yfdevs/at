import { toast } from "sonner";

import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page";
import {
  type PinduoduoDramaConfig,
  type PinduoduoDramaConfigResult,
  pinduoduoDramaService,
} from "@/platforms/pinduoduo-drama/service";

const emptyConfig: PinduoduoDramaConfig = {
  accountProfileName: "default",
  headless: "false",
  operationDelaySeconds: "0",
  runDataDir: ".drama-runs/pinduoduo-drama",
  logRetentionDays: "3",
  browserWindowWidth: "0",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
};

const sections: ConfigSectionDefinition<PinduoduoDramaConfig>[] = [
  {
    title: "浏览器与账号",
    description: "拼多多登录态和运行数据按账号配置独立保存。",
    fields: [
      {
        key: "accountProfileName",
        label: "账号配置名",
        description: "用于区分不同拼多多 MCN 登录态。",
      },
      {
        key: "runDataDir",
        label: "运行数据目录",
        description: "浏览器登录态、日志和运行文件保存到该目录。",
        directory: true,
      },
      {
        key: "localEpisodeVideoRoot",
        label: "剧集视频根目录",
        description: "审核通过后，百度网盘资源会下载并标准化到该目录下的剧名子目录。",
        directory: true,
      },
      {
        key: "operationDelaySeconds",
        label: "操作延迟",
        type: "number",
        description: "每一步 Playwright 操作之间的延迟。",
        suffix: "秒",
        step: "0.01",
      },
      {
        key: "browserWindowWidth",
        label: "浏览器宽度",
        type: "number",
        description: "填 0 使用主屏可用宽度，页面 viewport 会跟随真实窗口。",
        suffix: "px",
        min: 0,
        step: 1,
      },
      {
        key: "logRetentionDays",
        label: "日志保留",
        type: "number",
        description: "运行日志保留天数。",
        suffix: "天",
        min: 1,
        step: 1,
      },
      {
        key: "baiduNetdiskDownloadRetryAttempts",
        label: "百度下载重试",
        type: "number",
        description: "审核通过后准备视频资源时，百度网盘下载失败后的重试次数。",
        suffix: "次",
        min: 0,
        step: 1,
      },
      {
        kind: "switch",
        key: "headless",
        label: "浏览器窗口",
        description: "登录和排查问题时建议显示浏览器。",
        activeLabel: "无头运行",
        inactiveLabel: "显示浏览器",
      },
    ],
  },
];

export function PinduoduoDramaConfigurationPage() {
  const {
    config,
    discardChanges,
    hasChanges,
    loading,
    persistConfig,
    restartRequired,
    updateConfig,
  } = usePlatformConfig<PinduoduoDramaConfig, PinduoduoDramaConfigResult>({
    emptyConfig,
    getConfig: () => pinduoduoDramaService.getConfig(),
    saveConfig: (nextConfig) => pinduoduoDramaService.saveConfig(nextConfig),
  });

  const selectDirectory = async (key: string) => {
    try {
      const selectedPath =
        key === "runDataDir"
          ? await pinduoduoDramaService.selectRunDataDir(config.runDataDir)
          : key === "localEpisodeVideoRoot"
            ? await pinduoduoDramaService.selectLocalEpisodeVideoRoot(config.localEpisodeVideoRoot)
            : null;
      if (selectedPath) {
        if (key === "runDataDir" || key === "localEpisodeVideoRoot") {
          updateConfig(key, selectedPath);
        }
      }
    } catch (error) {
      toast.error("目录选择失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ConfigurationPageFrame
      hasChanges={hasChanges}
      loading={loading}
      restartRequired={restartRequired}
      title="拼多多短剧配置"
      onDiscard={discardChanges}
      onSave={persistConfig}
    >
      {sections.map((section) => (
        <ConfigSection
          key={section.title}
          config={config}
          fields={section.fields}
          section={section}
          onChange={updateConfig}
          onSelectDirectory={selectDirectory}
        />
      ))}
    </ConfigurationPageFrame>
  );
}
