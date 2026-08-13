import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createConnection, escapeId, type RowDataPacket } from "mysql2/promise";
import { readMysqlConnectionOptions } from "./mysqlConfig.js";

const MIGRATION_LOCK = "exploding-kitty-schema-migrations";
const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));
const options = readMysqlConnectionOptions();
if (!options) throw new Error("MySQL configuration is required to run migrations");
const database = options.database;
if (typeof database !== "string" || !/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error("MYSQL_DATABASE must contain only letters, numbers, and underscores");
}

// Connect before selecting the database so a fresh WeChat Cloud Run environment can
// create its dedicated game schema on the first container start.
const { database: _database, ...serverOptions } = options;
const connection = await createConnection({ ...serverOptions, multipleStatements: true });
let lockAcquired = false;
try {
  const [lockRows] = await connection.query<(RowDataPacket & { acquired: number | null })[]>(
    "SELECT GET_LOCK(?, 30) AS acquired",
    [MIGRATION_LOCK],
  );
  lockAcquired = lockRows[0]?.acquired === 1;
  if (!lockAcquired) throw new Error("Timed out waiting for the MySQL migration lock");

  await connection.query(
    `CREATE DATABASE IF NOT EXISTS ${escapeId(database)} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
  );
  // USE keeps the advisory lock on this connection. COM_CHANGE_USER would
  // reset session state and could release it before the DDL completes.
  await connection.query(`USE ${escapeId(database)}`);

  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(191) NOT NULL,
    applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`);

  const files = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files) {
    const [rows] = await connection.query<RowDataPacket[]>(
      "SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1",
      [file],
    );
    if (rows.length > 0) continue;

    // MySQL 5.7 implicitly commits DDL. Migration files must therefore be
    // retry-safe; the baseline uses CREATE TABLE IF NOT EXISTS throughout.
    await connection.query(await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8"));
    await connection.query("INSERT INTO schema_migrations(name) VALUES (?)", [file]);
    process.stdout.write(`Applied ${file}\n`);
  }
} finally {
  if (lockAcquired) await connection.query("SELECT RELEASE_LOCK(?)", [MIGRATION_LOCK]);
  await connection.end();
}
