import type Database from "better-sqlite3";
import { openAutomationDatabase } from "../database";

export type UploadRecord = {
  platformApplyId: number;
  title: string;
  episodeCount?: number;
  demoUrl?: string;
  status?: string;
  stage?: string;
  errorMessage?: string;
  attempts?: number;
  rawJson?: string;
  accountProfileName?: string;
  uploadedAt?: string;
  lastAttemptAt?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type UploadRecordsSummary = {
  total: number;
  pending: number;
  uploading: number;
  uploaded: number;
  failed: number;
};

export type ListUploadRecordsFilter = {
  status?: string;
  limit?: number;
  offset?: number;
};

type UploadRecordRow = {
  platformApplyId: number;
  title: string;
  episodeCount: number | null;
  demoUrl: string | null;
  status: string | null;
  stage: string | null;
  errorMessage: string | null;
  attempts: number | null;
  rawJson: string | null;
  accountProfileName: string | null;
  uploadedAt: string | null;
  lastAttemptAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

const selectUploadRecordColumns = `
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

const inProgressStatuses = ["DOWNLOADING", "READY", "UPLOADING"];

function migratePinduoduoApprovedUploadRecords(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS pinduoduo_approved_upload_records (
      platform_apply_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      episode_count INTEGER,
      demo_url TEXT,
      status TEXT,
      stage TEXT,
      error_message TEXT,
      attempts INTEGER,
      raw_json TEXT,
      account_profile_name TEXT,
      uploaded_at TEXT,
      last_attempt_at TEXT,
      created_at TEXT,
      updated_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_pinduoduo_upload_records_updated_at
      ON pinduoduo_approved_upload_records(updated_at);

    CREATE INDEX IF NOT EXISTS idx_pinduoduo_upload_records_status
      ON pinduoduo_approved_upload_records(status, updated_at);
  `);
}

function readUploadRecord(row: UploadRecordRow): UploadRecord {
  return {
    platformApplyId: row.platformApplyId,
    title: row.title,
    episodeCount: row.episodeCount ?? undefined,
    demoUrl: row.demoUrl ?? undefined,
    status: row.status ?? undefined,
    stage: row.stage ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    attempts: row.attempts ?? undefined,
    rawJson: row.rawJson ?? undefined,
    accountProfileName: row.accountProfileName ?? undefined,
    uploadedAt: row.uploadedAt ?? undefined,
    lastAttemptAt: row.lastAttemptAt ?? undefined,
    createdAt: row.createdAt ?? undefined,
    updatedAt: row.updatedAt ?? undefined,
  };
}

export class PinduoduoApprovedUploadRecordsRepository {
  private readonly database: Database.Database;
  readonly databasePath: string;

  constructor() {
    const openedDatabase = openAutomationDatabase();
    this.database = openedDatabase.database;
    this.databasePath = openedDatabase.databasePath;
    migratePinduoduoApprovedUploadRecords(this.database);
  }

  close(): void {
    this.database.close();
  }

  listUploadRecords(filter: ListUploadRecordsFilter = {}): {
    records: UploadRecord[];
    total: number;
    summary: UploadRecordsSummary;
  } {
    const statuses = filter.status
      ?.split(",")
      .map((status) => status.trim())
      .filter(Boolean);
    const limit = Math.max(1, Math.min(filter.limit ?? 200, 1000));
    const offset = Math.max(0, filter.offset ?? 0);

    const whereClause = statuses?.length
      ? `WHERE status IN (${statuses.map(() => "?").join(", ")})`
      : "";
    const whereParams = statuses ?? [];

    const rows = this.database
      .prepare(
        `
        SELECT ${selectUploadRecordColumns}
        FROM pinduoduo_approved_upload_records
        ${whereClause}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...whereParams, limit, offset) as UploadRecordRow[];

    const totalRow = this.database
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM pinduoduo_approved_upload_records
        ${whereClause}
      `,
      )
      .get(...whereParams) as { total: number } | undefined;

    return {
      records: rows.map(readUploadRecord),
      total: Number(totalRow?.total ?? 0),
      summary: this.summary(),
    };
  }

  resetFailedForRetry(): number {
    const result = this.database
      .prepare(
        `
        UPDATE pinduoduo_approved_upload_records
        SET status='PENDING',
            stage=NULL,
            error_message=NULL,
            updated_at=@now
        WHERE status='FAILED'
      `,
      )
      .run({ now: new Date().toISOString() });
    return result.changes;
  }

  private summary(): UploadRecordsSummary {
    const rows = this.database
      .prepare(
        `
        SELECT status, COUNT(*) AS count
        FROM pinduoduo_approved_upload_records
        GROUP BY status
      `,
      )
      .all() as Array<{ status: string | null; count: number }>;

    const summary: UploadRecordsSummary = {
      total: 0,
      pending: 0,
      uploading: 0,
      uploaded: 0,
      failed: 0,
    };
    for (const row of rows) {
      const count = Number(row.count);
      summary.total += count;
      if (row.status === "PENDING") summary.pending += count;
      else if (row.status === "UPLOADED") summary.uploaded += count;
      else if (row.status === "FAILED" || row.status === "REJECTED") summary.failed += count;
      else if (row.status && inProgressStatuses.includes(row.status)) summary.uploading += count;
    }
    return summary;
  }
}
