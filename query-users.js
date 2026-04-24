const { Client } = require('pg');
const fs = require('fs');

const url = fs.readFileSync('.env.production', 'utf-8')
  .split('\n')
  .find(line => line.startsWith('DATABASE_URL='))
  .split('=')[1]
  .replace(/"/g, '');

const client = new Client({
  connectionString: url
});

async function main() {
  await client.connect();
  const res = await client.query(`SELECT id, email, name FROM "User"`);
  console.table(res.rows);
  const accountsRes = await client.query(`SELECT id, "userId", provider, "providerAccountId" FROM "Account"`);
  console.table(accountsRes.rows);
  await client.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
