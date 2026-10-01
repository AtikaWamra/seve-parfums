// Vercel serverless function: creates a Stripe Checkout payment page.
// Prices are defined HERE on the server so nobody can change them from the browser.
// Keep this list in sync with CATALOG in index.html.

const PRODUCTS = {
  "figue-noire":  { name: "Figue Noire",  prices: [95, 140] },
  "iris-pluie":   { name: "Iris Pluie",   prices: [110, 160] },
  "neroli-atlas": { name: "Néroli Atlas", prices: [95, 140] },
  "the-fume":     { name: "Thé Fumé",     prices: [120, 175] },
  "rose-seche":   { name: "Rose Sèche",   prices: [130, 190] },
  "sel-diode":    { name: "Sel d'Iode",   prices: [95, 140] }
};
const SIZES = [50, 100];
const FREE_SHIPPING_FROM = 100;   // euros
const SHIPPING_PRICE = 6.90;      // euros
const COUNTRIES = ["FR", "BE", "CH", "LU", "MC", "DE", "IT", "ES", "NL", "PT"];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.STRIPE_SECRET_KEY) return res.status(500).json({ error: "Missing STRIPE_SECRET_KEY" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const lang = body.lang === "en" ? "en" : "fr";
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];

  const lines = [];
  let subtotal = 0;
  for (const it of items) {
    const p = PRODUCTS[String(it.id)];
    const size = Number(it.size) === 1 ? 1 : 0;
    const qty = Math.max(1, Math.min(10, parseInt(it.qty, 10) || 1));
    if (!p) continue;
    lines.push({ name: `${p.name} – ${SIZES[size]} ml`, amount: p.prices[size] * 100, qty });
    subtotal += p.prices[size] * qty;
  }
  if (!lines.length) return res.status(400).json({ error: "Empty bag" });

  const origin = req.headers.origin || `https://${req.headers.host}`;
  const shipping = subtotal >= FREE_SHIPPING_FROM ? 0 : Math.round(SHIPPING_PRICE * 100);

  // Stripe's API takes form-encoded data
  const f = new URLSearchParams();
  f.append("mode", "payment");
  f.append("locale", lang);
  f.append("success_url", `${origin}/?paid=1`);
  f.append("cancel_url", `${origin}/?canceled=1`);
  f.append("phone_number_collection[enabled]", "true");
  COUNTRIES.forEach((c, i) => f.append(`shipping_address_collection[allowed_countries][${i}]`, c));
  f.append("shipping_options[0][shipping_rate_data][type]", "fixed_amount");
  f.append("shipping_options[0][shipping_rate_data][fixed_amount][amount]", String(shipping));
  f.append("shipping_options[0][shipping_rate_data][fixed_amount][currency]", "eur");
  f.append("shipping_options[0][shipping_rate_data][display_name]", shipping ? (lang === "fr" ? "Livraison Colissimo" : "Standard delivery") : (lang === "fr" ? "Livraison offerte" : "Free delivery"));
  lines.forEach((l, i) => {
    f.append(`line_items[${i}][quantity]`, String(l.qty));
    f.append(`line_items[${i}][price_data][currency]`, "eur");
    f.append(`line_items[${i}][price_data][unit_amount]`, String(l.amount));
    f.append(`line_items[${i}][price_data][product_data][name]`, l.name);
  });

  try {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: f.toString()
    });
    const data = await r.json();
    if (!r.ok) { console.error("Stripe error", data); return res.status(502).json({ error: "Payment error" }); }
    return res.status(200).json({ url: data.url });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Stripe unreachable" });
  }
}
