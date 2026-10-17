import { createInterface } from "node:readline";
import { Pool } from "pg";
import { hashPassword } from "../lib/password-hash.js";
import { normalizePhone } from "../lib/phone.js";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("Missing DATABASE_URL. Run this inside the Next.js container after migrations finish.");
  process.exit(1);
}

function ask(question) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => terminal.question(question, (answer) => {
    terminal.close();
    resolve(answer);
  }));
}

function askHidden(question) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    throw new Error("Run this command with an interactive TTY so the initial password is not echoed.");
  }

  return new Promise((resolve, reject) => {
    let value = "";
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          cleanup();
          reject(new Error("Cancelled."));
          return;
        }
        if (char === "\r" || char === "\n") {
          cleanup();
          resolve(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = Array.from(value).slice(0, -1).join("");
          continue;
        }
        if (char >= " ") value += char;
      }
    };

    process.stdout.write(question);
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

const pool = new Pool({
  connectionString,
  max: 1,
  connectionTimeoutMillis: 5_000,
  application_name: "tutorial-website-admin-bootstrap",
  options: "-c timezone=UTC",
});

try {
  const phoneInput = await ask("شماره مدیر (مثال 09120000000): ");
  const phone = normalizePhone(phoneInput);
  if (!/^989\d{9}$/.test(phone)) throw new Error("شماره موبایل ایران معتبر نیست.");

  const password = await askHidden("رمز اولیه مدیر (حداقل ۱۲ نویسه، بدون نمایش): ");
  if (password.length < 12) throw new Error("رمز اولیه باید حداقل ۱۲ نویسه باشد.");
  const confirmation = await askHidden("تکرار رمز اولیه: ");
  if (password !== confirmation) throw new Error("دو رمز واردشده یکسان نیستند.");

  const existingAdmin = await pool.query(
    "SELECT id FROM public.site_users WHERE role = 'admin' LIMIT 1"
  );
  if (existingAdmin.rowCount > 0) {
    throw new Error("حداقل یک مدیر وجود دارد؛ bootstrap فقط برای دیتابیس بدون مدیر است.");
  }

  const existingPhone = await pool.query(
    "SELECT id FROM public.site_users WHERE phone = $1 LIMIT 1",
    [phone]
  );
  if (existingPhone.rowCount > 0) {
    throw new Error("این شماره از قبل ثبت شده است؛ اسکریپت هیچ حسابی را ارتقا یا بازنویسی نمی‌کند.");
  }

  const passwordHash = await hashPassword(password);
  const created = await pool.query(
    `INSERT INTO public.site_users (phone, password_hash, role, is_active)
     VALUES ($1, $2, 'admin', true)
     RETURNING id, phone, role`,
    [phone, passwordHash]
  );
  console.log(`مدیر اولیه ساخته شد: ${created.rows[0].phone} (${created.rows[0].id})`);
  console.log("این حساب را فقط برای ورود اولیه استفاده کنید و رمز را در مدیر رمز امن نگه دارید.");
} catch (error) {
  console.error(error?.message ?? "ساخت مدیر اولیه ناموفق بود.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
