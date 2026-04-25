import 'dotenv/config';
import postgres from 'postgres';
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    const fns = await sql<{ proname: string; nspname: string }[]>`
      SELECT n.nspname, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname IN ('current_user_id','set_updated_at','handle_new_user') ORDER BY p.proname
    `;
    console.log('Functions:', fns);
  } finally { await sql.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
