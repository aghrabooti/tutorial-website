import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../apps/next-app/db/migrations/0001_initial_schema.sql",
  import.meta.url
);

// PGlite executes PostgreSQL-compatible SQL in WASM. This is a fast schema
// regression check, not a replacement for the Docker/PostgreSQL staging gate.
test("self-hosted baseline schema and app-role permissions work in PGlite", async () => {
  const db = new PGlite();

  try {
    await db.exec(`
      CREATE ROLE tutorial_app WITH LOGIN PASSWORD 'ci-only-password';
      GRANT CONNECT ON DATABASE postgres TO tutorial_app;
      GRANT USAGE ON SCHEMA public TO tutorial_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO tutorial_app;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO tutorial_app;
    `);

    await db.exec(await readFile(migrationUrl, "utf8"));

    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    assert.deepEqual(tables.rows.map(({ table_name }) => table_name), [
      "cart_items",
      "course_sessions",
      "courses",
      "orders",
      "otp_codes",
      "shipments",
      "site_content",
      "site_users",
      "user_addresses",
      "user_purchases",
      "user_sessions",
    ]);

    const readiness = await db.query(`
      SELECT to_regclass('public.site_users') IS NOT NULL AS users_ready,
             to_regclass('public.courses') IS NOT NULL AS courses_ready
    `);
    assert.deepEqual(readiness.rows[0], {
      users_ready: true,
      courses_ready: true,
    });

    // Exercise the same role boundary as Compose: migrations are applied by
    // postgres, while the app role gets only DML rights on created tables.
    await db.exec("SET ROLE tutorial_app");
    const role = await db.query(`
      SELECT current_user, rolsuper
      FROM pg_catalog.pg_roles
      WHERE rolname = current_user
    `);
    assert.deepEqual(role.rows[0], {
      current_user: "tutorial_app",
      rolsuper: false,
    });

    const user = await db.query(
      `INSERT INTO public.site_users (phone, password_hash)
       VALUES ($1, $2) RETURNING id, updated_at`,
      ["989121234567", "test-password-hash"]
    );
    assert.match(user.rows[0].id, /^[0-9a-f-]{36}$/i);

    const course = await db.query(
      `INSERT INTO public.courses (title, price)
       VALUES ($1, $2) RETURNING id`,
      ["Schema smoke course", 1000]
    );
    await db.query(
      `INSERT INTO public.cart_items (user_id, course_id) VALUES ($1, $2)`,
      [user.rows[0].id, course.rows[0].id]
    );

    await db.query(
      `UPDATE public.site_users
       SET first_name = 'Smoke', updated_at = TIMESTAMP '2000-01-01 00:00:00'
       WHERE id = $1`,
      [user.rows[0].id]
    );
    const updatedUser = await db.query(
      "SELECT updated_at FROM public.site_users WHERE id = $1",
      [user.rows[0].id]
    );
    assert.ok(new Date(updatedUser.rows[0].updated_at).getUTCFullYear() > 2000);

    await assert.rejects(
      db.query(
        `INSERT INTO public.site_users (phone, password_hash)
         VALUES ($1, $2)`,
        ["989121234567", "duplicate"]
      ),
      (error) => error.code === "23505"
    );
    await assert.rejects(
      db.query(
        `INSERT INTO public.site_users (phone, password_hash, role)
         VALUES ($1, $2, $3)`,
        ["989121234568", "invalid-role", "owner"]
      ),
      (error) => error.code === "23514"
    );
    await assert.rejects(
      db.query(
        `INSERT INTO public.cart_items (user_id, course_id) VALUES ($1, $2)`,
        [user.rows[0].id, "00000000-0000-4000-8000-000000000001"]
      ),
      (error) => error.code === "23503"
    );

    await db.query("DELETE FROM public.courses WHERE id = $1", [course.rows[0].id]);
    const remainingCartItems = await db.query(
      "SELECT id FROM public.cart_items WHERE user_id = $1",
      [user.rows[0].id]
    );
    assert.equal(remainingCartItems.rowCount, 0);
  } finally {
    await db.close();
  }
});
