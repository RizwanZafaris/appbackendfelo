import 'dotenv/config';
import postgres from 'postgres';
async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, ssl: 'require' });
  try {
    await sql.unsafe(`
      CREATE OR REPLACE FUNCTION public.current_user_id()
      RETURNS UUID LANGUAGE plpgsql STABLE AS $$
      DECLARE
        app_user TEXT;
        resolved UUID;
      BEGIN
        app_user := current_setting('app.user_id', true);
        IF app_user IS NOT NULL AND app_user <> '' THEN
          RETURN app_user::uuid;
        END IF;
        IF auth.uid() IS NOT NULL THEN
          SELECT u.id INTO resolved
          FROM public.profiles u
          WHERE u.id = auth.uid()
          LIMIT 1;
          RETURN resolved;
        END IF;
        RETURN NULL;
      END;
      $$;
    `);
    console.log('current_user_id() created');
  } finally { await sql.end(); }
}
main().catch(e => { console.error(e); process.exit(1); });
