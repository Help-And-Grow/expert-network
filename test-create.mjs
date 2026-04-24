import fs from 'fs'
import pkg from 'pg'
const { Client } = pkg

const url = fs.readFileSync('.env.production', 'utf-8')
  .split('\n')
  .find(line => line.startsWith('DATABASE_URL='))
  .split('=')[1]
  .replace(/"/g, '');

const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  try {
    const res = await client.query(`
      INSERT INTO "User" (id, email, "emailVerified", name, "updatedAt") 
      VALUES ('test1234', 'test@example.com', NOW(), 'Test User', NOW())
      RETURNING id;
    `);
    console.log("Created user:", res.rows[0]);
    
    const accRes = await client.query(`
      INSERT INTO "Account" (id, "userId", type, provider, "providerAccountId")
      VALUES ('acc1234', 'test1234', 'oauth', 'google', 'google1234')
      RETURNING id;
    `);
    console.log("Created account:", accRes.rows[0]);

    await client.query(`DELETE FROM "Account" WHERE id='acc1234'`);
    await client.query(`DELETE FROM "User" WHERE id='test1234'`);
    console.log("Cleanup done.");
  } catch(e) {
    console.error("DB Error:", e);
  }
  await client.end();
}

main();
