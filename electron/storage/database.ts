import Database from "better-sqlite3";
import { app } from "electron";
import { mkdirSync } from "node:fs";
import path from "node:path";

export function automationDatabasePath() {
  return path.join(app.getPath("userData"), "automation.sqlite");
}

export function openAutomationDatabase(): {
  database: Database.Database;
  databasePath: string;
} {
  const databasePath = automationDatabasePath();
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  return { database, databasePath };
}
