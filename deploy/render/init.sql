SELECT pg_advisory_lock(190726, 1);
SELECT to_regclass('public.courses') IS NULL AS setup_required \gset
\if :setup_required
  \i /etc/tutorial/schema.sql
  INSERT INTO courses (id, title, type, description, price)
    VALUES ('render-demo-course', 'دورهٔ آزمایشی', 'course', 'دادهٔ نمونه برای تست نسخهٔ Render', 1000);
\endif
SELECT pg_advisory_unlock(190726, 1);
