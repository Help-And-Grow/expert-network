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

async function tableExists(client) {
  const result = await client.query(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = 'ExpertDomain'
    ) AS exists
  `);
  return Boolean(result.rows[0]?.exists);
}

async function main() {
  const client = new Client({ connectionString: connectionString() });
  await client.connect();

  try {
    const exists = await tableExists(client);
    if (!exists) {
      console.log('[drop-expert-domain] "ExpertDomain" already absent.');
      return;
    }

    const { rows } = await client.query('SELECT COUNT(*)::int AS count FROM "ExpertDomain"');
    const count = rows[0]?.count ?? 0;
    console.log(`[drop-expert-domain] Dropping "ExpertDomain" with ${count} row(s).`);
    await client.query('DROP TABLE "ExpertDomain"');
    console.log('[drop-expert-domain] Drop complete.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("[drop-expert-domain]", error instanceof Error ? error.message : error);
  process.exit(1);
});
