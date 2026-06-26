export type TiktokDramaCenterLoginState = "login-required" | "logged-in" | "unknown";

export interface TiktokDramaCenterBrowserOptions {
  userDataDir?: string;
  headless?: boolean;
  slowMo?: number;
  keepOpenAfterRun?: boolean;
  keepOpenOnError?: boolean;
}

export interface TiktokDramaCenterConfig {
  browser?: TiktokDramaCenterBrowserOptions;
  dryRun?: boolean;
}

export type TiktokDramaCenterRuntimeStatus = {
  platform: "tiktok-drama-center";
  running: boolean;
  loginState: TiktokDramaCenterLoginState;
  activeUrl?: string;
  userDataDir: string;
};

export type TiktokDramaCenterRuntimeOptions = {
  config?: TiktokDramaCenterConfig;
  userDataDir?: string;
  credentialStatePath?: string;
  onLog?: (message: string) => void;
};

export type TiktokDramaCenterRuntime = {
  getStatus: () => TiktokDramaCenterRuntimeStatus;
  stop: () => Promise<void>;
};
