// Smoke-test the admin panel rendering with mock API responses:
//   node tests/admin-panel.test.cjs
const path = require("path");
const fs = require("fs");
const { JSDOM } = require(path.join(__dirname, "node_modules", "jsdom"));

const root = path.resolve(__dirname, "..");

const html = fs.readFileSync(`${root}/admin.html`, "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", url: "https://example.com/admin" });

const { window } = dom;

// admin session
window.localStorage.setItem("session_token", "tok_123");
window.localStorage.setItem("user", JSON.stringify({ role: "admin", first_name: "مهدی" }));

const responses = {
  "admin-overview": {
    success: true,
    stats: { revenue_rial: 100000, paid_orders: 3, users: 9, pending_shipments: 2, missing_shipments: 1 },
    gateway: {
      sandbox: false,
      mode: "production",
      merchant_configured: true,
      merchant_masked: "12345678…abcd",
      callback_url: "https://mahdiazizi.com/payment-result",
      price_to_rial_factor: 10,
      problems: [],
    },
  },
  "admin-orders": {
    success: true,
    orders: [
      {
        id: "o1", created_at: new Date().toISOString(), status: "paid", source: "cart",
        amount_rial: 101010, ref_id: 12345, user_name: "علی رضایی", user_phone: "09120000000",
        items: ["کتاب تست 1"], needs_shipping: true, shipment_status: "pending", tracking_code: null,
      },
      {
        id: "o2", created_at: new Date().toISOString(), status: "paid", source: "direct",
        amount_rial: 1010, ref_id: 999, user_name: "سارا", user_phone: "09121111111",
        items: ["دوره ریاضی"], needs_shipping: false, shipment_status: null, tracking_code: null,
      },
      {
        id: "o3", created_at: new Date().toISOString(), status: "paid", source: "cart",
        amount_rial: 5000, ref_id: 777, user_name: "حسن", user_phone: "09122222222",
        items: ["جزوه فیزیک"], needs_shipping: true, shipment_status: "none", tracking_code: null,
      },
    ],
  },
  "admin-shipments": {
    success: true,
    shipments: [
      {
        id: "s1", order_id: "o1", status: "pending", tracking_code: null, full_name: "علی رضایی",
        phone: "09120000000", province: "تهران", city: "تهران", address: "خیابان آزادی",
        postal_code: "1234567890", created_at: new Date().toISOString(), sent_at: null,
        amount_rial: 101010, ref_id: 12345, items: ["کتاب تست 1"], user_name: "علی رضایی",
        user_phone: "09120000000", no_shipment: false,
      },
      {
        id: "s2", order_id: "o9", status: "sent", tracking_code: "12 345", full_name: "زهرا",
        phone: "09123333333", province: "قم", city: "قم", address: "خیابان ارم",
        postal_code: "0987654321", created_at: new Date().toISOString(), sent_at: new Date().toISOString(),
        amount_rial: 2020, ref_id: 555, items: ["کتاب"], user_name: "زهرا", user_phone: "09123333333",
        no_shipment: false,
      },
    ],
    missing_shipments: [
      {
        id: null, order_id: "o3", status: "no_shipment", tracking_code: null, full_name: "حسن",
        phone: "09122222222", province: null, city: null, address: null, postal_code: null,
        created_at: new Date().toISOString(), sent_at: null, amount_rial: 5000, ref_id: 777,
        items: ["جزوه فیزیک"], user_name: "حسن", user_phone: "09122222222", no_shipment: true,
      },
    ],
    sync: { created: 1, missing_address: 0, failed: 0, needs_shipping: 3 },
  },
  "admin-users": { success: true, users: [{ first_name: "مهدی", last_name: "عزیزی", phone: "0912", role: "admin" }] },
};

const calls = [];
window.apiCall = (fn, data) => {
  calls.push({ fn, data });
  return Promise.resolve(structuredClone(responses[fn]));
};
window.alert = (m) => console.log("ALERT:", m);
window.fetch = () => Promise.reject(new Error("no network in test"));
window.navigator.clipboard = { writeText: async () => {} };

let code = fs.readFileSync(`${root}/js/admin.js`, "utf8");

// neutralize the redirect-guard + network-only pieces
code = code.replace('if (!checkAdmin()) {\n    throw new Error("unauthorized");\n}', "");

const runner = new window.Function("window", "document", "localStorage", "alert", "apiCall", "fetch", "navigator", "setTimeout", code + "\n; return { switchTab, loadShipments, loadOrders, loaders, renderShipments };");

const api = runner(window, window.document, window.localStorage, window.alert, window.apiCall, window.fetch, window.navigator, window.setTimeout);

(async () => {
  // overview
  await api.loaders.overview();
  console.log("=== GATEWAY BOX ===");
  console.log(window.document.getElementById("gateway-content").textContent.replace(/\s+/g, " ").trim());

  // orders
  await api.loadOrders();
  console.log("=== ORDERS ROWS ===");
  const rows = window.document.querySelectorAll("#orders-body tr");
  rows.forEach((r) => console.log("-", r.textContent.replace(/\s+/g, " ").trim()));

  // shipments
  await api.loadShipments();
  console.log("=== SHIPMENTS ALERT ===");
  console.log(window.document.getElementById("shipments-alert").textContent.replace(/\s+/g, " ").trim());
  console.log("=== SHIPMENTS (filter=pending) ===");
  window.document.querySelectorAll("#shipments-list > div").forEach((d) =>
    console.log("-", d.textContent.replace(/\s+/g, " ").trim().slice(0, 220))
  );

  window.document.getElementById("shipments-filter").value = "sent";
  api.renderShipments();
  console.log("=== SHIPMENTS (filter=sent) ===");
  window.document.querySelectorAll("#shipments-list > div").forEach((d) =>
    console.log("-", d.textContent.replace(/\s+/g, " ").trim().slice(0, 160))
  );

  window.document.getElementById("shipments-filter").value = "all";
  api.renderShipments();
  console.log("=== SHIPMENTS (filter=all) count ===", window.document.querySelectorAll("#shipments-list > div").length);

  console.log("=== API CALLS ===", calls.map((c) => c.fn + ":" + (c.data.action ?? "")).join(", "));
})().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
