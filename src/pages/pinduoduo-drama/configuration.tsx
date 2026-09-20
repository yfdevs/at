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
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const emptyConfig: PinduoduoDramaConfig = {
  accountProfileName: "default",
  creatorUid: "7735796497358",
  browserExecutablePath: "",
  headless: "false",
  runDataDir: ".drama-runs/pinduoduo-drama",
  logRetentionDays: "3",
  taskPollIntervalMinutes: "120",
  localEpisodeVideoRoot: "",
  baiduNetdiskDownloadRetryAttempts: "3",
};

const sections: ConfigSectionDefinition<PinduoduoDramaConfig>[] = [
  {
    title: "浏览器与账号",
    description: "拼多多登录态按账号隔离；共享目录在全局配置中统一管理。",
    fields: [
      {
        key: "creatorUid",
        label: "创作者 UID",
        description: "用于打开视频上传页面。",
      },
      {
        key: "browserExecutablePath",
        label: "浏览器可执行文件路径",
        description: "浏览器 exe 路径；留空使用默认 Chrome。",
      },
      {
        key: "accountProfileName",
        label: "账号配置名",
        description: "用于区分不同拼多多 MCN 登录态。",
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
        key: "taskPollIntervalMinutes",
        label: "任务轮询间隔",
        type: "number",
        description: "每轮任务检查和审核状态复查的间隔。",
        suffix: "分钟",
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

  const testBrowserPath = async () => {
    try {
      const result = await pinduoduoDramaService.testBrowserPath(config.browserExecutablePath);
      if (result.ok) {
        toast.success("浏览器路径测试通过", { description: result.message });
      } else {
        toast.error("浏览器路径测试失败", { description: result.message });
      }
    } catch (error) {
      toast.error("浏览器路径测试失败", {
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
      {sections.map((section, index) => (
        <ConfigSection
          key={section.title}
          config={config}
          fields={section.fields}
          section={section}
          footer={index === 0 ? (
            <Button disabled={loading} onClick={() => void testBrowserPath()} variant="outline">
              测试浏览器路径
            </Button>
          ) : undefined}
          onChange={updateConfig}
        />
      ))}
    </ConfigurationPageFrame>
  );
}
