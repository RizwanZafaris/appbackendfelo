import 'dotenv/config';
import postgres from 'postgres';

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    const rows = await sql<{ def: string }[]>`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
    `;
    if (!rows.length) {
      console.log('❌ handle_new_user trigger NOT installed');
      return;
    }
    const def = rows[0].def;
    const hasCorridor = def.includes('corridor');
    const hasPhone = def.includes('phone_e164');
    const hasLang = def.includes('language_code');
    console.log(hasCorridor && hasPhone && hasLang
      ? '✅ Step A4 applied — trigger pulls display_name, phone_e164, corridor, country, language_code'
      : '⚠️  Old trigger still in place — Step A4 SQL was NOT run yet'
    );
    console.log('   corridor field:      ' + (hasCorridor ? '✅' : '❌'));
    console.log('   phone_e164 field:    ' + (hasPhone ? '✅' : '❌'));
    console.log('   language_code field: ' + (hasLang ? '✅' : '❌'));
  } finally {
    await sql.end();
  }
}
main().catch(err => { console.error(err); process.exit(1); });
