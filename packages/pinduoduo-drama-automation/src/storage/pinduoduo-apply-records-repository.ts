import type Database from "better-sqlite3";
import type {
  ClaimedPinduoduoDramaTask,
  PinduoduoDramaRuntimeOptions,
} from "../shared/types.js";
import type { ShortplayApplyRecord } from "../app/shortplay-manage-page.js";
import { migratePinduoduoApplyRecords } from "./pinduoduo-apply-records-schema.js";
import type {
  PinduoduoLocalAuditStatus,
  PinduoduoTrackedApplyRecord,
  PinduoduoTrackedApplyRecordRow,
} from "./pinduoduo-apply-records-types.js";
import { openAutomationDatabase } from "./database.js";
import { nullsToUndefined } from "./record-utils.js";

const AUDIT_CHECK_DELAY_MS = 2 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

function nextAuditCheckIso(date = new Date()): string {
  return new Date(date.getTime() + AUDIT_CHECK_DELAY_MS).toISOString();
}

const pinduoduoApplyRecordSelect = `
  account_task_id AS accountTaskId,
  drama_id AS dramaId,
  account_profile_name AS accountProfileName,
  pinduoduo_account_id AS pinduoduoAccountId,
  pinduoduo_account_name AS pinduoduoAccountName,
  title,
  original_title AS originalTitle,
  payload_json AS payloadJson,
  platform_apply_id AS platformApplyId,
  platform_title AS platformTitle,
  platform_status AS platformStatus,
  platform_reject_reason AS platformRejectReason,
  audit_status AS auditStatus,
  video_status AS videoStatus,
  raw_json AS rawJson,
  submitted_at AS submittedAt,
  last_checked_at AS lastCheckedAt,
  next_check_at AS nextCheckAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

function readTrackedApplyRecord(row: PinduoduoTrackedApplyRecordRow): PinduoduoTrackedApplyRecord {
  return nullsToUndefined(row);
}

export class PinduoduoApplyRecordsRepository {
  private readonly database: Database.Database;

  constructor(private readonly options: PinduoduoDramaRuntimeOptions) {
    this.database = openAutomationDatabase(options);
    migratePinduoduoApplyRecords(this.database);
  }

  close(): void {
    this.database.close();
  }

  upsertSubmittedRecord(task: ClaimedPinduoduoDramaTask, record: ShortplayApplyRecord | null): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        INSERT INTO pinduoduo_apply_records (
          account_task_id,
          drama_id,
          account_profile_name,
          pinduoduo_account_id,
          pinduoduo_account_name,
          title,
          original_title,
          payload_json,
          platform_apply_id,
          platform_title,
          platform_status,
          platform_reject_reason,
          audit_status,
          video_status,
          raw_json,
          submitted_at,
          next_check_at,
          created_at,
          updated_at
        ) VALUES (
          @accountTaskId,
          @dramaId,
          @accountProfileName,
          @pinduoduoAccountId,
          @pinduoduoAccountName,
          @title,
          @originalTitle,
          @payloadJson,
          @platformApplyId,
          @platformTitle,
          @platformStatus,
          @platformRejectReason,
          'PENDING',
          'NOT_READY',
          @rawJson,
          @submittedAt,
          @nextCheckAt,
          @createdAt,
          @updatedAt
        )
        ON CONFLICT(account_task_id) DO UPDATE SET
          drama_id=excluded.drama_id,
          account_profile_name=excluded.account_profile_name,
          pinduoduo_account_id=excluded.pinduoduo_account_id,
          pinduoduo_account_name=excluded.pinduoduo_account_name,
          title=excluded.title,
          original_title=excluded.original_title,
          payload_json=excluded.payload_json,
          platform_apply_id=excluded.platform_apply_id,
          platform_title=excluded.platform_title,
          platform_status=excluded.platform_status,
          platform_reject_reason=excluded.platform_reject_reason,
          audit_status='PENDING',
          raw_json=excluded.raw_json,
          submitted_at=excluded.submitted_at,
          next_check_at=excluded.next_check_at,
          updated_at=excluded.updated_at
      `,
      )
      .run({
        accountProfileName: this.options.accountProfileName ?? null,
        accountTaskId: task.accountTaskId,
        createdAt: timestamp,
        dramaId: task.dramaId ?? null,
        nextCheckAt: nextAuditCheckIso(),
        originalTitle: task.originalTitle,
        payloadJson: JSON.stringify(task.playlet),
        pinduoduoAccountId: task.pinduoduoAccountId ?? null,
        pinduoduoAccountName: task.pinduoduoAccountName ?? null,
        platformApplyId: record?.id ?? null,
        platformRejectReason: record?.rejectReason ?? null,
        platformStatus: record?.status ?? null,
        platformTitle: record?.title ?? task.playlet.title,
        rawJson: record ? JSON.stringify(record) : null,
        submittedAt: timestamp,
        title: task.playlet.title,
        updatedAt: timestamp,
      });
  }

  markAuditChecked(
    trackedRecord: PinduoduoTrackedApplyRecord,
    auditStatus: PinduoduoLocalAuditStatus,
    record: ShortplayApplyRecord | null,
  ): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_apply_records
        SET
          audit_status=@auditStatus,
          platform_apply_id=COALESCE(@platformApplyId, platform_apply_id),
          platform_title=COALESCE(@platformTitle, platform_title),
          platform_status=@platformStatus,
          platform_reject_reason=@platformRejectReason,
          raw_json=@rawJson,
          last_checked_at=@lastCheckedAt,
          next_check_at=@nextCheckAt,
          video_status=CASE
            WHEN @auditStatus = 'APPROVED' AND video_status = 'NOT_READY' THEN 'READY'
            ELSE video_status
          END,
          updated_at=@updatedAt
        WHERE account_task_id=@accountTaskId
      `,
      )
      .run({
        accountTaskId: trackedRecord.accountTaskId,
        auditStatus,
        lastCheckedAt: timestamp,
        nextCheckAt: auditStatus === "PENDING" ? nextAuditCheckIso() : null,
        platformApplyId: record?.id ?? null,
        platformRejectReason: record?.rejectReason ?? null,
        platformStatus: record?.status ?? null,
        platformTitle: record?.title ?? null,
        rawJson: record ? JSON.stringify(record) : null,
        updatedAt: timestamp,
      });
  }

  markVideoResourceReady(trackedRecord: PinduoduoTrackedApplyRecord): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_apply_records
        SET video_status='RESOURCE_READY', updated_at=@updatedAt
        WHERE account_task_id=@accountTaskId
      `,
      )
      .run({
        accountTaskId: trackedRecord.accountTaskId,
        updatedAt: timestamp,
      });
  }

  findDueAuditRecord(): PinduoduoTrackedApplyRecord | null {
    const row = this.database
      .prepare(
        `
        SELECT ${pinduoduoApplyRecordSelect}
        FROM pinduoduo_apply_records
        WHERE audit_status='PENDING'
          AND (next_check_at IS NULL OR next_check_at <= @now)
        ORDER BY COALESCE(next_check_at, submitted_at, created_at) ASC
        LIMIT 1
      `,
      )
      .get({ now: nowIso() }) as PinduoduoTrackedApplyRecordRow | undefined;

    return row ? readTrackedApplyRecord(row) : null;
  }

  findVideoReadyRecord(): PinduoduoTrackedApplyRecord | null {
    const row = this.database
      .prepare(
        `
        SELECT ${pinduoduoApplyRecordSelect}
        FROM pinduoduo_apply_records
        WHERE audit_status='APPROVED'
          AND video_status='READY'
        ORDER BY updated_at ASC
        LIMIT 1
      `,
      )
      .get() as PinduoduoTrackedApplyRecordRow | undefined;

    return row ? readTrackedApplyRecord(row) : null;
  }
}
