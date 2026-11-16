BEGIN;

CREATE TABLE site_users (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    phone text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    first_name text NOT NULL DEFAULT '',
    last_name text NOT NULL DEFAULT '',
    full_name text GENERATED ALWAYS AS (btrim(first_name || ' ' || last_name)) STORED,
    grade text,
    major text,
    role text NOT NULL DEFAULT 'student',
    is_active boolean NOT NULL DEFAULT true,
    last_login timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id text NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_user_idx ON user_sessions(user_id);

CREATE TABLE courses (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    title text NOT NULL,
    grade text,
    major text,
    category text,
    type text NOT NULL,
    description text,
    price numeric NOT NULL DEFAULT 0,
    discount_price numeric,
    image_url text,
    requires_shipping boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE course_sessions (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    session_number integer NOT NULL,
    title text NOT NULL,
    video_url text,
    is_online boolean NOT NULL DEFAULT false,
    online_url text,
    scheduled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX course_sessions_course_idx ON course_sessions(course_id, session_number);

CREATE TABLE cart_items (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id text NOT NULL REFERENCES site_users(id) ON DELETE CASCADE,
    course_id text NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE TABLE user_purchases (
    id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id text NOT NULL,
    course_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_id)
);

CREATE TABLE user_addresses (
    user_id text PRIMARY KEY,
    full_name text,
    phone text,
    province text,
    city text,
    address text,
    postal_code text,
    updated_at timestamptz DEFAULT now()
);

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    authority text UNIQUE,
    amount_rial bigint NOT NULL DEFAULT 0,
    description text,
    status text NOT NULL DEFAULT 'init',
    source text NOT NULL DEFAULT 'cart',
    items jsonb NOT NULL DEFAULT '[]',
    course_ids text[] NOT NULL DEFAULT '{}',
    ref_id bigint,
    card_pan text,
    created_at timestamptz NOT NULL DEFAULT now(),
    verified_at timestamptz
);
CREATE INDEX orders_user_status_idx ON orders(user_id, status);
CREATE INDEX orders_status_created_idx ON orders(status, created_at DESC);

CREATE TABLE shipments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid UNIQUE,
    user_id text,
    full_name text,
    phone text,
    province text,
    city text,
    address text,
    postal_code text,
    status text NOT NULL DEFAULT 'pending',
    tracking_code text,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE site_content (
    key text PRIMARY KEY,
    value text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text
);

CREATE TABLE otp_codes (
    phone text PRIMARY KEY,
    code_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    grant_hash text,
    grant_expires_at timestamptz
);

CREATE FUNCTION reserve_registration_otp(p_phone text, p_code_hash text, p_lifetime integer, p_cooldown integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE remaining integer;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_phone, 0));
    SELECT ceil(extract(epoch FROM created_at + make_interval(secs => p_cooldown) - now()))::integer
      INTO remaining FROM otp_codes WHERE phone = p_phone;
    IF remaining > 0 THEN
        RETURN remaining;
    END IF;

    INSERT INTO otp_codes (phone, code_hash, expires_at)
      VALUES (p_phone, p_code_hash, now() + make_interval(secs => p_lifetime))
    ON CONFLICT (phone) DO UPDATE SET code_hash = excluded.code_hash,
      created_at = now(), expires_at = excluded.expires_at, attempts = 0,
      grant_hash = null, grant_expires_at = null;
    RETURN 0;
END;
$$;

CREATE FUNCTION verify_registration_otp(p_phone text, p_code_hash text, p_grant_hash text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE challenge otp_codes%ROWTYPE;
BEGIN
    SELECT * INTO challenge FROM otp_codes WHERE phone = p_phone FOR UPDATE;
    IF NOT FOUND OR challenge.expires_at <= now() OR challenge.grant_hash IS NOT NULL THEN
        RETURN 'expired';
    END IF;
    IF challenge.attempts >= 5 THEN
        RETURN 'locked';
    END IF;

    IF challenge.code_hash <> p_code_hash THEN
        UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = p_phone;
        RETURN 'invalid';
    END IF;

    UPDATE otp_codes SET grant_hash = p_grant_hash, grant_expires_at = now() + interval '5 minutes'
      WHERE phone = p_phone;
    RETURN 'ok';
END;
$$;

CREATE FUNCTION register_verified_user(
    p_phone text, p_grant_hash text, p_password_hash text, p_first_name text, p_last_name text
)
RETURNS TABLE (id text, phone text, full_name text) LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM otp_codes AS otp
      WHERE otp.phone = p_phone AND otp.grant_hash = p_grant_hash AND otp.grant_expires_at > now();
    IF NOT FOUND THEN RETURN; END IF;

    RETURN QUERY
      INSERT INTO site_users AS u (phone, password_hash, first_name, last_name)
      VALUES (p_phone, p_password_hash, p_first_name, p_last_name)
      RETURNING u.id, u.phone, u.full_name;
END;
$$;

CREATE FUNCTION replace_course_sessions(p_course text, p_sessions jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    PERFORM 1 FROM courses WHERE id = p_course FOR NO KEY UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Course not found' USING ERRCODE = '23503'; END IF;

    IF EXISTS (
      SELECT FROM jsonb_array_elements(p_sessions) AS item
      WHERE item->>'id' IS NOT NULL AND NOT EXISTS (
        SELECT FROM course_sessions WHERE id = item->>'id' AND course_id = p_course
      )
    ) THEN
      RAISE EXCEPTION 'Session does not belong to this course' USING ERRCODE = '23503';
    END IF;

    DELETE FROM course_sessions AS s WHERE s.course_id = p_course
      AND NOT EXISTS (SELECT FROM jsonb_array_elements(p_sessions) AS item WHERE item->>'id' = s.id);

    INSERT INTO course_sessions (id, course_id, session_number, title, video_url, is_online, online_url, scheduled_at)
      SELECT coalesce(x.id, gen_random_uuid()::text), p_course, x.session_number, x.title,
        x.video_url, x.is_online, x.online_url, x.scheduled_at
      FROM jsonb_to_recordset(p_sessions) AS x(id text, session_number integer, title text,
        video_url text, is_online boolean, online_url text, scheduled_at timestamptz)
    ON CONFLICT (id) DO UPDATE SET session_number = excluded.session_number, title = excluded.title,
      video_url = excluded.video_url, is_online = excluded.is_online,
      online_url = excluded.online_url, scheduled_at = excluded.scheduled_at;
END;
$$;

CREATE ROLE tutorial_api NOLOGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO tutorial_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tutorial_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tutorial_api;

COMMIT;
