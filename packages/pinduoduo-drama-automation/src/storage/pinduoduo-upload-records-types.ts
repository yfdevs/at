export type PinduoduoUploadRecordStatus =
  | "PENDING"
  | "DOWNLOADING"
  | "READY"
  | "UPLOADING"
  | "UPLOADED"
  | "FAILED"
  | "REJECTED";

export type PinduoduoUploadRecordStage =
  | "DOWNLOAD"
  | "OPEN_PAGE"
  | "UPLOAD"
  | "VERIFY"
  | "BIND"
  | "PUBLISH";

export type PinduoduoUploadRecord = {
  accountProfileName?: string;
  attempts: number;
  createdAt: string;
  demoUrl?: string;
  episodeCount?: number;
  errorMessage?: string;
  lastAttemptAt?: string;
  platformApplyId: number;
  rawJson?: string;
  stage?: PinduoduoUploadRecordStage;
  status: PinduoduoUploadRecordStatus;
  title: string;
  updatedAt: string;
  uploadedAt?: string;
};

export type PinduoduoUploadRecordRow = Omit<
  PinduoduoUploadRecord,
  | "accountProfileName"
  | "demoUrl"
  | "episodeCount"
  | "errorMessage"
  | "lastAttemptAt"
  | "rawJson"
  | "stage"
  | "uploadedAt"
> & {
  accountProfileName: string | null;
  demoUrl: string | null;
  episodeCount: number | null;
  errorMessage: string | null;
  lastAttemptAt: string | null;
  rawJson: string | null;
  stage: PinduoduoUploadRecordStage | null;
  uploadedAt: string | null;
};
