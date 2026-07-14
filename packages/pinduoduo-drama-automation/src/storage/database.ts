import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PinduoduoDramaRuntimeOptions } from "../shared/types.js";

const AUTOMATION_DATABASE_FILENAME = "automation.sqlite";

export function resolveAutomationDatabasePath(options: PinduoduoDramaRuntimeOptions): string {
  if (options.databasePath) {
    return options.databasePath;
  }

  if (options.userDataDir) {
    return join(dirname(options.userDataDir), AUTOMATION_DATABASE_FILENAME);
  }

  throw new Error("AUTOMATION_DATABASE_PATH_REQUIRED");
}

export function openAutomationDatabase(options: PinduoduoDramaRuntimeOptions): Database.Database {
  const databasePath = resolveAutomationDatabasePath(options);
  mkdirSync(dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return database;
}
