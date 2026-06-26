export type KuaishouDramaLoginState = "login-required" | "logged-in" | "unknown";

export interface KuaishouDramaBrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  slowMo?: number;
  keepOpenAfterRun?: boolean;
  keepOpenOnError?: boolean;
}

export interface KuaishouDramaConfig {
  browser?: KuaishouDramaBrowserOptions;
  dryRun?: boolean;
}

export type KuaishouDramaRuntimeStatus = {
  platform: "kuaishou-drama";
  running: boolean;
  loginState: KuaishouDramaLoginState;
  activeUrl?: string;
  userDataDir: string;
};

export type KuaishouDramaRuntimeOptions = {
  config?: KuaishouDramaConfig;
  userDataDir?: string;
  credentialStatePath?: string;
  onLog?: (message: string) => void;
};

export type KuaishouDramaRuntime = {
  getStatus: () => KuaishouDramaRuntimeStatus;
  stop: () => Promise<void>;
};
