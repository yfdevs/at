export type MeituanCreationCollectionSchema =
  | {
      type: "真人短剧（含AI）";
      subType: "真人短剧" | "AI真人短剧";
    }
  | {
      type: "动漫短剧";
      subType: "动态漫" | "沙雕漫" | "PPT漫";
    };

export interface MeituanCreationBrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  slowMo?: number;
  keepOpenAfterRun?: boolean;
  keepOpenOnError?: boolean;
}

export interface MeituanCreationVideoDraft {
  videoFile?: string;
  title?: string;
  description?: string;
  tags?: string[];
}

export interface MeituanCreationConfig {
  browser?: MeituanCreationBrowserOptions;
  dryRun?: boolean;
  authorNicknameText?: string;
  collection?: MeituanCreationCollectionSchema;
  publish?: {
    submit?: boolean;
  };
  video?: MeituanCreationVideoDraft;
}

export type MeituanCreationRuntimeStatus = {
  platform: "meituan-creation";
  loginUrl: string;
  publishVideoUrl: string;
  running: boolean;
  loginState: "login-required" | "logged-in" | "unknown";
  activeUrl?: string;
  userDataDir: string;
};

export type MeituanCreationRuntimeOptions = {
  config?: MeituanCreationConfig;
  userDataDir?: string;
  credentialStatePath?: string;
  onLog?: (message: string) => void;
};

export type MeituanCreationRuntime = {
  getStatus: () => MeituanCreationRuntimeStatus;
  stop: () => Promise<void>;
};
