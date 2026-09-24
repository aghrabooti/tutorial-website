// تست بسته‌ی سئو: node tests/seo.test.mjs
// بررسی می‌کند که بلاک‌های سئو درست، یک‌تا و معتبر باشند و با robots/sitemap هم‌خوان باشند.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const SITE = "https://www.mahdiazizi.com";

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

const read = (f) => readFileSync(path.join(ROOT, f), "utf8");

const INDEXABLE = {
  "index.html": `${SITE}/`,
  "courses.html": `${SITE}/courses`,
  "about-us.html": `${SITE}/about-us`,
  "cart.html": `${SITE}/cart`,
  "login.html": `${SITE}/login`,
  "register.html": `${SITE}/register`,
  "complete-profile.html": `${SITE}/complete-profile`,
};

// سایتمپ: صفحات تراکنشی (سبد خرید) عمداً نیستند
const SITEMAP_URLS = Object.entries(INDEXABLE)
  .filter(([f]) => f !== "cart.html")
  .map(([, u]) => u);

const NOINDEX = [
  "dashboard.html",
  "payment-result.html",
  "shipping-address.html",
  "admin.html",
  "admin-login.html",
  "admin-courses.html",
];

const START = "<!-- SEO:START";
const END = "<!-- SEO:END -->";

console.log("── بلاک سئو در صفحات عمومی ──");
for (const [file, canonical] of Object.entries(INDEXABLE)) {
  const html = read(file);

  check(`${file}: یک بلاک سئو`, html.split(START).length - 1 === 1);
  check(`${file}: canonical صحیح`, html.includes(`<link rel="canonical" href="${canonical}">`), canonical);
  check(`${file}: description دارد`, /<meta name="description" content="[^"]{40,}"/.test(html));
  check(`${file}: og:image دارد`, html.includes('property="og:image"'));
  check(`${file}: favicon دارد`, html.includes('rel="icon" href="/favicon.ico"'));
  check(`${file}: robots=index`, html.includes('content="index, follow'));

  // همه‌ی JSON-LD ها باید JSON معتبر باشند
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  for (const [, body] of blocks) {
    let ok = true;
    let err = "";
    try {
      JSON.parse(body);
    } catch (e) {
      ok = false;
      err = e.message;
    }
    check(`${file}: JSON-LD معتبر (${blocks.length} بلاک)`, ok, err);
  }
}

console.log("\n── صفحات خصوصی نباید ایندکس شوند ──");
for (const file of NOINDEX) {
  const html = read(file);
  check(`${file}: noindex`, html.includes('content="noindex, nofollow"'));
  check(`${file}: canonical ندارد`, !html.includes('rel="canonical"'));
}

console.log("\n── هویت و لینک‌های شبکه‌های اجتماعی ──");
{
  const html = read("index.html");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1])
  );
  const person = ld.find((x) => x["@type"] === "Person");
  const academy = ld.find((x) => x["@type"] === "EducationalOrganization");
  const site = ld.find((x) => x["@type"] === "WebSite");

  check("Person وجود دارد", !!person);
  check("نام استاد درست است", person?.name === "مهدی عزیزی");
  check("alternateName برند دارد", (person?.alternateName ?? []).includes("استاد مهدی عزیزی"));
  const SOCIALS = {
    "تلگرام": "https://t.me/mahdiazizi_math",
    "اینستاگرام": "https://www.instagram.com/mahdiazizi_math/",
    "آپارات": "https://www.aparat.com/mahdiazizii",
    "بله": "https://ble.ir/mahdiiazizii_math",
  };

  check("sameAs هر چهار شبکه‌ی اجتماعی را دارد", (person?.sameAs ?? []).length === 4, JSON.stringify(person?.sameAs));
  for (const [name, url] of Object.entries(SOCIALS)) {
    check(`sameAs شامل ${name} است`, (person?.sameAs ?? []).includes(url), url);
  }
  check("آکادمی هم همان لینک‌ها را دارد", (academy?.sameAs ?? []).length === 4);
  check("EducationalOrganization وجود دارد", !!academy);
  check("WebSite وجود دارد و به آکادمی وصل است", !!site && site.publisher?.["@id"]?.includes("#academy"));
}

console.log("\n── Schema دوره‌ها در صفحه‌ی دوره‌ها ──");
{
  const html = read("courses.html");
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) =>
    JSON.parse(m[1])
  );
  const graph = ld.flatMap((x) => x["@graph"] ?? []);
  const courses = graph.filter((x) => x["@type"] === "Course");

  check("Schema دوره‌ها هست", courses.length > 5, `${courses.length} دوره`);
  check("هر دوره قیمت دارد", courses.every((c) => typeof c.offers?.price === "number"));
  check("هر دوره لینک دارد", courses.every((c) => typeof c.url === "string" && c.url.includes("courses-detail?id=")));
  check("پایه‌ی تحصیلی ثبت شده", courses.some((c) => c.educationalLevel));
}

console.log("\n── فوتر: لینک‌های شبکه‌های اجتماعی با rel=me ──");
{
  const footer = read("components/footer.html");
  const hrefs = [...footer.matchAll(/href="(https:\/\/(?:t\.me|www\.instagram|www\.aparat|ble\.ir)[^"]+)"/g)].map((m) => m[1]);

  for (const [name, url] of Object.entries({
    "تلگرام": "https://t.me/mahdiazizi_math",
    "اینستاگرام": "https://www.instagram.com/mahdiazizi_math/",
    "آپارات": "https://www.aparat.com/mahdiazizii",
    "بله": "https://ble.ir/mahdiiazizii_math",
  })) {
    check(`فوتر: لینک ${name}`, hrefs.includes(url), url);
  }

  check("فوتر: هر چهار لینک rel=me دارند", (footer.match(/rel="me noopener"/g) ?? []).length >= 4);
  check("فوتر: لینک‌ها در تب جدید باز می‌شوند", (footer.match(/target="_blank"/g) ?? []).length >= 4);
  check("فوتر: aria-label دارد (دسترس‌پذیری)", (footer.match(/aria-label="/g) ?? []).length >= 4);
  check("فوتر: کد اینماد دست‌نخورده است", footer.includes("trustseal.enamad.ir/logo.aspx?id=6934655"));
}

console.log("\n── صفحه‌ی درباره ما: آمار واقعی شبکه‌ها ──");
{
  const about = read("about-us.html");
  check("بخش شبکه‌های اجتماعی هست", about.includes("استاد مهدی عزیزی در شبکه‌های اجتماعی"));
  check("آمار تلگرام درج شده", about.includes("۵۹٬۰۰۰+ عضو"));
  check("آمار بله درج شده", about.includes("۱۳٬۱۰۰+ عضو"));
  check("آمار آپارات درج شده", about.includes("۲۳۸٬۰۰۰ بازدید"));
  check("پلیس‌هولدر عددهای رزومه حفظ شده (NN)", about.includes(">NN<"));
}

console.log("\n── robots.txt و sitemap.xml ──");
{
  const robots = read("robots.txt");
  check("robots.txt: خط Sitemap", robots.includes(`Sitemap: ${SITE}/sitemap.xml`));
  check("robots.txt: پنل‌ها مسدودند", ["/admin", "/dashboard", "/payment-result"].every((p) => robots.includes(`Disallow: ${p}`)));
  check("robots.txt: ربات‌های AI اجازه دارند", robots.includes("User-agent: GPTBot") && robots.includes("User-agent: PerplexityBot"));

  const sm = read("sitemap.xml");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  check(`sitemap.xml: ${SITEMAP_URLS.length} آدرس`, locs.length === SITEMAP_URLS.length, String(locs.length));
  check("sitemap.xml: URL های اصلی در آن هستند", SITEMAP_URLS.every((u) => locs.includes(u)));
  check(
    "sitemap.xml: صفحات پنل/داشبورد/سبد/پرداخت نیستند",
    !locs.some((u) => /dashboard|admin|payment-result|cart/.test(u))
  );
}

console.log("\n── فایل‌های دارایی سئو ──");
for (const f of ["favicon.ico", "sitemap.xml", "robots.txt", "assets/images/og-cover.jpg", "assets/images/favicon-512.png", "assets/images/apple-touch-icon.png"]) {
  check(`${f} وجود دارد`, existsSync(path.join(ROOT, f)));
}

console.log("\n── صفحات حذف‌شده ──");
check("test-api.html (شماره+رمز هاردکد) حذف شده", !existsSync(path.join(ROOT, "test-api.html")));
check("فایل خالی 27624581.txt حذف شده", !existsSync(path.join(ROOT, "27624581.txt")));

console.log(failures === 0 ? "\nALL SEO CHECKS PASSED ✅" : `\n${failures} CHECK(S) FAILED ❌`);
process.exit(failures === 0 ? 0 : 1);
