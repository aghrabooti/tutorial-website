import "server-only";

export function toLatinDigits(value) {
  return String(value ?? "")
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

export function normalizePhone(phone) {
  let normalized = String(phone ?? "").trim().replace(/\s+/g, "");

  if (normalized.startsWith("09")) {
    normalized = `98${normalized.substring(1)}`;
  }

  if (normalized.startsWith("+98")) {
    normalized = normalized.substring(1);
  }

  return normalized;
}
