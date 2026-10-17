-- Baseline reconstructed from the schema catalog output supplied by the owner.
-- This targets a NEW standalone PostgreSQL database; do not run it on Supabase.
-- RLS policies are enforced in Next.js routes after the Supabase API is removed.

CREATE TABLE public.site_users (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    phone varchar(15) NOT NULL,
    password_hash varchar(255) NOT NULL,
    role varchar(20) DEFAULT 'student',
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_login timestamp without time zone,
    first_name varchar(50) NOT NULL DEFAULT ''::varchar,
    last_name varchar(50) NOT NULL DEFAULT ''::varchar,
    grade text,
    major text,
    CONSTRAINT site_users_pkey PRIMARY KEY (id),
    CONSTRAINT site_users_phone_key UNIQUE (phone),
    CONSTRAINT site_users_role_check
        CHECK (role::text = ANY (ARRAY['student'::varchar, 'teacher'::varchar, 'admin'::varchar]::text[]))
);

CREATE TABLE public.courses (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    title text,
    grade bigint,
    category text,
    type text,
    description text,
    price bigint,
    discount_price bigint,
    image_url text,
    major text,
    requires_shipping boolean NOT NULL DEFAULT false,
    CONSTRAINT coursed_pkey PRIMARY KEY (id)
);

CREATE TABLE public.course_sessions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    course_id uuid NOT NULL,
    session_number integer NOT NULL,
    title text NOT NULL,
    description text,
    content_type text NOT NULL DEFAULT 'video'::text,
    provider text NOT NULL DEFAULT 'aparat'::text,
    video_url text,
    file_url text,
    duration integer,
    is_free boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    is_online boolean NOT NULL DEFAULT false,
    online_url text,
    scheduled_at timestamp with time zone,
    CONSTRAINT course_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT course_sessions_course_id_fkey
        FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE
);

CREATE TABLE public.cart_items (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT cart_items_pkey PRIMARY KEY (id),
    CONSTRAINT cart_items_user_id_course_id_key UNIQUE (user_id, course_id),
    CONSTRAINT cart_items_course_id_fkey
        FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE,
    CONSTRAINT cart_items_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.site_users(id) ON DELETE CASCADE
);

CREATE TABLE public.orders (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    authority text,
    amount_rial bigint NOT NULL,
    description text,
    status text NOT NULL DEFAULT 'init'::text,
    source text NOT NULL DEFAULT 'cart'::text,
    items jsonb NOT NULL DEFAULT '[]'::jsonb,
    ref_id bigint,
    card_pan text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    verified_at timestamp with time zone,
    course_ids text[] NOT NULL DEFAULT '{}'::text[],
    CONSTRAINT orders_pkey PRIMARY KEY (id),
    CONSTRAINT orders_authority_key UNIQUE (authority)
);

CREATE TABLE public.otp_codes (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    phone varchar(15) NOT NULL,
    code_hash varchar(255) NOT NULL,
    purpose varchar(30) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    attempts integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    CONSTRAINT otp_codes_pkey PRIMARY KEY (id),
    CONSTRAINT otp_codes_purpose_check
        CHECK (purpose::text = ANY (ARRAY['register'::varchar, 'reset_password'::varchar, 'change_phone'::varchar]::text[]))
);

CREATE TABLE public.shipments (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL,
    user_id text NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    province text NOT NULL,
    city text NOT NULL,
    address text NOT NULL,
    postal_code text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'pending'::text,
    tracking_code text,
    sent_at timestamp with time zone,
    CONSTRAINT shipments_pkey PRIMARY KEY (id),
    CONSTRAINT shipments_order_id_key UNIQUE (order_id),
    CONSTRAINT shipments_order_id_fkey
        FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE
);

CREATE TABLE public.site_content (
    key text NOT NULL,
    value text NOT NULL DEFAULT ''::text,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_by uuid,
    CONSTRAINT site_content_pkey PRIMARY KEY (key)
);

CREATE TABLE public.user_addresses (
    user_id text NOT NULL,
    full_name text NOT NULL,
    phone text NOT NULL,
    province text NOT NULL,
    city text NOT NULL,
    address text NOT NULL,
    postal_code text NOT NULL,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_addresses_pkey PRIMARY KEY (user_id)
);

CREATE TABLE public.user_purchases (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    course_id uuid NOT NULL,
    purchased_at timestamp with time zone NOT NULL DEFAULT now(),
    payment_status text NOT NULL DEFAULT 'paid'::text,
    amount numeric(10,2),
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_purchases_pkey PRIMARY KEY (id),
    CONSTRAINT user_purchases_user_id_course_id_key UNIQUE (user_id, course_id),
    CONSTRAINT user_purchases_course_id_fkey
        FOREIGN KEY (course_id) REFERENCES public.courses(id) ON DELETE CASCADE,
    CONSTRAINT user_purchases_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.site_users(id) ON DELETE CASCADE
);

CREATE TABLE public.user_sessions (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    token_hash varchar(255) NOT NULL,
    user_agent text,
    ip_address varchar(45),
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    is_active boolean DEFAULT true,
    CONSTRAINT user_sessions_pkey PRIMARY KEY (id),
    CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash),
    CONSTRAINT user_sessions_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.site_users(id) ON DELETE CASCADE
);

CREATE INDEX idx_otp_phone ON public.otp_codes USING btree (phone);
CREATE INDEX idx_otp_purpose ON public.otp_codes USING btree (purpose);
CREATE INDEX idx_sessions_token ON public.user_sessions USING btree (token_hash);
CREATE INDEX idx_sessions_user ON public.user_sessions USING btree (user_id);
CREATE INDEX idx_users_phone ON public.site_users USING btree (phone);
CREATE INDEX orders_created_idx ON public.orders USING btree (created_at DESC);
CREATE INDEX orders_status_idx ON public.orders USING btree (status);
CREATE INDEX orders_user_idx ON public.orders USING btree (user_id);
CREATE INDEX shipments_created_idx ON public.shipments USING btree (created_at DESC);
CREATE INDEX shipments_order_idx ON public.shipments USING btree (order_id);
CREATE INDEX shipments_status_idx ON public.shipments USING btree (status);
CREATE INDEX site_content_updated_at_idx ON public.site_content USING btree (updated_at DESC);
CREATE UNIQUE INDEX user_addresses_user_id_key ON public.user_addresses USING btree (user_id);

-- Source definition confirmed by the owner's Supabase SQL Editor output.
CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_site_users_updated_at
BEFORE UPDATE ON public.site_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
