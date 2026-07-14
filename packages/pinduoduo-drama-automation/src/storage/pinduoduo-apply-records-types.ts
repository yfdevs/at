export type PinduoduoLocalAuditStatus = "PENDING" | "APPROVED" | "REJECTED" | "UNKNOWN";

export type PinduoduoLocalVideoStatus =
  | "NOT_READY"
  | "READY"
  | "RESOURCE_READY"
  | "UPLOADING"
  | "UPLOADED";

export type PinduoduoTrackedApplyRecord = {
  accountProfileName?: string;
  accountTaskId: number;
  auditStatus: PinduoduoLocalAuditStatus;
  createdAt: string;
  dramaId?: number;
  lastCheckedAt?: string;
  nextCheckAt?: string;
  originalTitle: string;
  payloadJson: string;
  pinduoduoAccountId?: string;
  pinduoduoAccountName?: string;
  platformApplyId?: number;
  platformRejectReason?: string;
  platformStatus?: number;
  platformTitle: string;
  rawJson?: string;
  submittedAt?: string;
  title: string;
  updatedAt: string;
  videoStatus: PinduoduoLocalVideoStatus;
};

export type PinduoduoTrackedApplyRecordRow = Omit<
  PinduoduoTrackedApplyRecord,
  | "accountProfileName"
  | "dramaId"
  | "lastCheckedAt"
  | "nextCheckAt"
  | "pinduoduoAccountId"
  | "pinduoduoAccountName"
  | "platformApplyId"
  | "platformRejectReason"
  | "platformStatus"
  | "rawJson"
  | "submittedAt"
> & {
  accountProfileName: string | null;
  dramaId: number | null;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  pinduoduoAccountId: string | null;
  pinduoduoAccountName: string | null;
  platformApplyId: number | null;
  platformRejectReason: string | null;
  platformStatus: number | null;
  rawJson: string | null;
  submittedAt: string | null;
};
