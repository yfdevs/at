import type Database from "better-sqlite3";
import type { PinduoduoDramaRuntimeOptions } from "../shared/types.js";
import type { ShortplayApplyRecord } from "../app/shortplay-manage-page.js";
import { migratePinduoduoUploadRecords } from "./pinduoduo-upload-records-schema.js";
import type {
  PinduoduoUploadRecord,
  PinduoduoUploadRecordRow,
  PinduoduoUploadRecordStage,
} from "./pinduoduo-upload-records-types.js";
import { openAutomationDatabase } from "./database.js";
import { nullsToUndefined } from "./record-utils.js";

function nowIso(): string {
  return new Date().toISOString();
}

const pinduoduoUploadRecordSelect = `
  platform_apply_id AS platformApplyId,
  title,
  episode_count AS episodeCount,
  demo_url AS demoUrl,
  status,
  stage,
  error_message AS errorMessage,
  attempts,
  raw_json AS rawJson,
  account_profile_name AS accountProfileName,
  uploaded_at AS uploadedAt,
  last_attempt_at AS lastAttemptAt,
  created_at AS createdAt,
  updated_at AS updatedAt
`;

function readUploadRecord(row: PinduoduoUploadRecordRow): PinduoduoUploadRecord {
  return nullsToUndefined(row);
}

export class PinduoduoUploadRecordsRepository {
  private readonly database: Database.Database;

  constructor(private readonly options: PinduoduoDramaRuntimeOptions) {
    this.database = openAutomationDatabase(options);
    migratePinduoduoUploadRecords(this.database);
  }

  close(): void {
    this.database.close();
  }

  upsertFromApprovedList(records: ShortplayApplyRecord[]): void {
    const timestamp = nowIso();
    const statement = this.database.prepare(
      `
      INSERT INTO pinduoduo_approved_upload_records (
        platform_apply_id,
        title,
        episode_count,
        demo_url,
        status,
        attempts,
        raw_json,
        account_profile_name,
        created_at,
        updated_at
      ) VALUES (
        @platformApplyId,
        @title,
        @episodeCount,
        @demoUrl,
        'PENDING',
        0,
        @rawJson,
        @accountProfileName,
        @createdAt,
        @updatedAt
      )
      ON CONFLICT(platform_apply_id) DO UPDATE SET
        title=excluded.title,
        episode_count=excluded.episode_count,
        demo_url=excluded.demo_url,
        raw_json=excluded.raw_json,
        updated_at=excluded.updated_at
    `,
    );

    for (const record of records) {
      if (record.id === undefined) continue;
      statement.run({
        accountProfileName: this.options.accountProfileName ?? null,
        createdAt: timestamp,
        demoUrl: record.demoUrl ?? null,
        episodeCount: record.episodeCount ?? null,
        platformApplyId: record.id,
        rawJson: JSON.stringify(record),
        title: record.title,
        updatedAt: timestamp,
      });
    }
  }

  findProcessableRecords(maxAttempts = 3): PinduoduoUploadRecord[] {
    const rows = this.database
      .prepare(
        `
        SELECT ${pinduoduoUploadRecordSelect}
        FROM pinduoduo_approved_upload_records
        WHERE status='PENDING'
          OR (status='FAILED' AND attempts < @maxAttempts)
        ORDER BY updated_at ASC
      `,
      )
      .all({ maxAttempts }) as PinduoduoUploadRecordRow[];

    return rows.map(readUploadRecord);
  }

  markDownloading(platformApplyId: number): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET
          status='DOWNLOADING',
          attempts=attempts+1,
          stage=NULL,
          error_message=NULL,
          last_attempt_at=@lastAttemptAt,
          updated_at=@updatedAt
        WHERE platform_apply_id=@platformApplyId
      `,
      )
      .run({
        lastAttemptAt: timestamp,
        platformApplyId,
        updatedAt: timestamp,
      });
  }

  markReady(platformApplyId: number): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET status='READY', updated_at=@updatedAt
        WHERE platform_apply_id=@platformApplyId
      `,
      )
      .run({
        platformApplyId,
        updatedAt: timestamp,
      });
  }

  markUploading(platformApplyId: number): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET status='UPLOADING', updated_at=@updatedAt
        WHERE platform_apply_id=@platformApplyId
      `,
      )
      .run({
        platformApplyId,
        updatedAt: timestamp,
      });
  }

  markUploaded(platformApplyId: number): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET
          status='UPLOADED',
          stage=NULL,
          error_message=NULL,
          uploaded_at=@uploadedAt,
          updated_at=@updatedAt
        WHERE platform_apply_id=@platformApplyId
      `,
      )
      .run({
        platformApplyId,
        updatedAt: timestamp,
        uploadedAt: timestamp,
      });
  }

  markFailed(
    platformApplyId: number,
    stage: PinduoduoUploadRecordStage,
    errorMessage: string,
  ): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET
          status='FAILED',
          stage=@stage,
          error_message=@errorMessage,
          updated_at=@updatedAt
        WHERE platform_apply_id=@platformApplyId
      `,
      )
      .run({
        errorMessage,
        platformApplyId,
        stage,
        updatedAt: timestamp,
      });
  }

  markRejected(platformApplyId: number, errorMessage: string): void {
    const timestamp = nowIso();
    this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET
          status='REJECTED',
          stage='VERIFY',
          error_message=@errorMessage,
          updated_at=@updatedAt
        WHERE platform_apply_id=@platformApplyId
      `,
      )
      .run({
        errorMessage,
        platformApplyId,
        updatedAt: timestamp,
      });
  }
}
