import fs from "fs";
import path from "path";
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function main() {
  const schemaPath = path.resolve("schema.sql");
    let sql = fs.readFileSync(schemaPath, "utf-8");
  if (sql.charCodeAt(0) === 0xfeff) {
    sql = sql.slice(1);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    multipleStatements: true,
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.changeUser({ database: process.env.DB_NAME });
  await connection.query(sql);
  await connection.end();

  console.log("Schema applied successfully.");
}

main().catch((error) => {
  console.error("Failed to apply schema:", error);
  process.exit(1);
});

