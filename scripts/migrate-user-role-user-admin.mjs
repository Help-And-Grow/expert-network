import "dotenv/config";

import pg from "pg";

const { Client } = pg;

function connectionString() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    throw new Error("Set DIRECT_URL or DATABASE_URL before running this migration.");
  }
  const parsed = new URL(url);
  if (parsed.searchParams.has("sslmode") && !parsed.searchParams.has("uselibpqcompat")) {
    parsed.searchParams.set("uselibpqcompat", "true");
  }
  return parsed.toString();
}

async function enumValues(client) {
  const result = await client.query(`
    SELECT e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'UserRole'
    ORDER BY e.enumsortorder
  `);
  return result.rows.map((row) => row.enumlabel);
}

async function main() {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();

  try {
    const before = await enumValues(client);
    if (before.length === 0) {
      throw new Error('Postgres enum type "UserRole" was not found.');
    }

    const desired = ["USER", "ADMIN"];
    if (before.length === desired.length && before.every((value, index) => value === desired[index])) {
      console.log("[migrate-user-role] UserRole already normalized: USER, ADMIN");
      return;
    }

    console.log(`[migrate-user-role] Current UserRole enum: ${before.join(", ")}`);
    await client.query("BEGIN");
    await client.query('ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT');
    await client.query('ALTER TABLE "User" ALTER COLUMN "role" TYPE text USING CASE WHEN "role"::text = \'ADMIN\' THEN \'ADMIN\' ELSE \'USER\' END');
    await client.query('DROP TYPE "UserRole"');
    await client.query('CREATE TYPE "UserRole" AS ENUM (\'USER\', \'ADMIN\')');
    await client.query('ALTER TABLE "User" ALTER COLUMN "role" TYPE "UserRole" USING "role"::"UserRole"');
    await client.query('ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT \'USER\'::"UserRole"');
    await client.query("COMMIT");

    const after = await enumValues(client);
    const counts = await client.query('SELECT "role"::text AS role, COUNT(*)::int AS count FROM "User" GROUP BY "role" ORDER BY "role"');
    console.log(`[migrate-user-role] New UserRole enum: ${after.join(", ")}`);
    for (const row of counts.rows) {
      console.log(`[migrate-user-role] ${row.role}: ${row.count}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[migrate-user-role]", error instanceof Error ? error.message : error);
  process.exit(1);
});
