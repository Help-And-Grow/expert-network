import fs from 'fs'
import pg from 'pg'
const { Client } = pg

const url = fs.readFileSync('.env.production', 'utf-8')
  .split('\n')
  .find(line => line.startsWith('DATABASE_URL='))
  .split('=')[1]
  .replace(/"/g, '');

const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  try {
    const res = await client.query(`SHOW transaction_read_only;`);
    console.log("Read only:", res.rows[0]);
  } catch(e) {
    console.error("DB Error:", e);
  }
  await client.end();
}

main();
