import { ExternalLink } from "@mynaui/icons-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { returnRouteFromLocationState, routePath } from "@/config/navigation";
import {
  ConfigSection,
  ConfigurationPageFrame,
  type ConfigSectionDefinition,
  usePlatformConfig,
} from "@/pages/shared/configuration-page";
import { globalAppConfigService, type GlobalAppConfig } from "@/platforms/app-config/service";

const emptyConfig: GlobalAppConfig = {
  aiApiKey: "",
  aiBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
  aiModel: "doubao-seed-2-0-pro-260215",
  aiImageModel: "doubao-seedream-4-0-250828",
  aiPosterFallbackEnabled: true,
  localAiEnabled: false,
  localAiModelPath: "",
  localAiMmprojPath: "",
  localAiContextSize: "4096",
  localAiThreads: "",
  baiduNetdiskDownloadTimeoutMinutes: "60",
  runDataRoot: "",
  localMaterialRoot: "",
};

const sections: ConfigSectionDefinition<GlobalAppConfig>[] = [
  {
    title: "文件与目录",
    description: "所有平台共用；运行数据与素材需放在同一磁盘",
    fields: [
      {
        key: "runDataRoot",
        label: "运行数据根目录",
        description: "登录态、日志和缓存会按平台写入独立子目录",
        directory: true,
      },
      {
        key: "localMaterialRoot",
        label: "素材根目录",
        description: "所有平台按原始剧名从这里读取或下载视频、封面及权属材料",
        directory: true,
      },
    ],
  },
  {
    title: "百度网盘",
    description: "所有平台共用的百度网盘资源下载限制",
    fields: [
      {
        key: "baiduNetdiskDownloadTimeoutMinutes",
        label: "下载超时",
        description: "单个资源等待下载完成的最长时间；超时后停止下载并上报任务失败。",
        type: "number",
        suffix: "分钟",
        min: 1,
      },
      {
        kind: "switch",
        key: "aiPosterFallbackEnabled",
        label: "缺少海报时 AI 生成",
        description: "网盘资源没有海报或封面时，使用剧名和简介生成一张封面源图，再由对应平台处理比例和尺寸。",
        activeLabel: "已开启",
        inactiveLabel: "已关闭",
      },
    ],
  },
  {
    title: "本地 AI 推理",
    description: "用于辅助识别文件名无法区分的剪映与剧创权属截图；其他 AI 任务继续使用云端模型",
    fields: [
      {
        kind: "switch",
        key: "localAiEnabled",
        label: "启用本地权属截图识别",
        description: "优先按文件名分类；无法从名称判断时才启动本地模型。关闭后完全沿用原有分类方式",
        activeLabel: "本地权属识别已开启",
        inactiveLabel: "未开启",
      },
      {
        key: "localAiModelPath",
        label: "GGUF 主模型",
        description: "选择支持对话的 GGUF 模型；图片理解需使用视觉语言模型",
        file: true,
      },
      {
        key: "localAiMmprojPath",
        label: "多模态投影模型",
        description: "图片理解模型需要时选择对应的 mmproj GGUF 文件；纯文本任务可留空",
        file: true,
      },
      {
        key: "localAiContextSize",
        label: "上下文长度",
        description: "数值越大占用内存越多",
        type: "number",
        min: 1,
      },
      {
        key: "localAiThreads",
        label: "CPU 线程数",
        description: "留空时由 llama.cpp 自动选择",
        type: "number",
        min: 1,
      },
    ],
  },
  {
    title: "云端 AI 服务",
    description: "现有平台的文本理解、图片理解和图片生成均继续使用此配置",
    fields: [
      {
        key: "aiApiKey",
        label: "API Key",
        description: "密钥使用系统凭据加密保存在本机，不写入环境变量或日志",
        type: "password",
      },
      {
        key: "aiModel",
        label: "模型 ID",
        description: "可用于封面理解、主体定位、图片分类和文本推理",
      },
      {
        key: "aiImageModel",
        label: "图片生成模型 ID",
        description: "",
      },
      {
        key: "aiBaseURL",
        label: "API Base URL",
        description: "填写 OpenAI 兼容接口地址",
        type: "url",
      },
    ],
  },
];

export function GlobalConfigurationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [testing, setTesting] = useState(false);
  const returnRoute = returnRouteFromLocationState(location.state);
  const configState = usePlatformConfig({
    emptyConfig,
    getConfig: globalAppConfigService.getConfig,
    saveConfig: globalAppConfigService.saveConfig,
  });
  const localAiEnabled = String(configState.config.localAiEnabled) === "true";

  const testConnection = async (target: "cloud" | "local") => {
    setTesting(true);
    try {
      const result = await globalAppConfigService.testConfig({
        ...configState.config,
        localAiEnabled: target === "local",
      });
      toast.success(target === "local" ? "本地模型运行正常" : "云端 AI 服务连接成功", {
        description: `${result.model} · ${result.latencyMs} ms · ${result.responseText}`,
      });
    } catch (error) {
      toast.error("AI 服务连接失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  const selectDirectory = async (key: keyof GlobalAppConfig) => {
    if (key !== "runDataRoot" && key !== "localMaterialRoot") return;

    try {
      const selected = await globalAppConfigService.selectDirectory(key, configState.config[key]);
      if (selected) configState.updateConfig(key, selected);
    } catch (error) {
      toast.error("目录选择失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const selectLocalAiFile = async (key: keyof GlobalAppConfig) => {
    if (key !== "localAiModelPath" && key !== "localAiMmprojPath") return;

    try {
      const selected = await globalAppConfigService.selectLocalAiFile(
        key,
        configState.config[key],
      );
      if (selected) configState.updateConfig(key, selected);
    } catch (error) {
      toast.error("模型文件选择失败", {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <ConfigurationPageFrame
      hasChanges={configState.hasChanges}
      loading={configState.loading}
      restartRequired={configState.restartRequired}
      title="全局配置"
      onClose={() => {
        void navigate(routePath(returnRoute));
      }}
      onDiscard={configState.discardChanges}
      onSave={configState.persistConfig}
    >
      {sections.map((section) => (
        <ConfigSection
          key={section.title}
          config={configState.config}
          fields={
            section.title === "本地 AI 推理" && !localAiEnabled
              ? section.fields.filter((field) => field.key === "localAiEnabled")
              : section.fields
          }
          footer={
            section.title === "云端 AI 服务" ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  className="w-fit"
                  onClick={() => {
                    void globalAppConfigService.openArkApiKeyPage();
                  }}
                  size="sm"
                  variant="ghost"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  获取火山方舟 API Key
                </Button>
                <Button
                  className="w-fit"
                  disabled={configState.loading || testing}
                  onClick={() => {
                    void testConnection("cloud");
                  }}
                  size="sm"
                  variant="outline"
                >
                  {testing ? "测试中…" : "测试云端图片与文本能力"}
                </Button>
              </div>
            ) : section.title === "本地 AI 推理" && localAiEnabled ? (
              <Button
                className="w-fit"
                disabled={configState.loading || testing}
                onClick={() => {
                  void testConnection("local");
                }}
                size="sm"
                variant="outline"
              >
                {testing ? "正在加载模型…" : "启动并测试本地模型"}
              </Button>
            ) : undefined
          }
          section={section}
          onChange={configState.updateConfig}
          onSelectDirectory={selectDirectory}
          onSelectFile={selectLocalAiFile}
        />
      ))}
    </ConfigurationPageFrame>
  );
}
