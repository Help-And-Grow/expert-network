import { createRequire } from "module";
const require = createRequire(import.meta.url);

async function main() {
  const url = process.env.DATABASE_URL || "postgresql://mock:mock@localhost:5432/mock";
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: url });
  
  const result = await pool.query(`SELECT id, "audioIntroUrl" FROM "Expert" WHERE "audioIntroUrl" IS NOT NULL LIMIT 1`);
  
  if (result.rows.length === 0) {
    console.log("No expert with audioIntroUrl found.");
    return;
  }

  const expert = result.rows[0];
  console.log("Found expert:", expert.id);
  console.log("audioIntroUrl length:", expert.audioIntroUrl?.length);
  console.log("audioIntroUrl starts with:", expert.audioIntroUrl?.slice(0, 50));
  
  await pool.end();
}

main().catch(console.error);
