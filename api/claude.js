// Vercel serverless function: forwards the website's AI requests to Claude.
// Your API key stays here on the server (in Vercel's Environment Variables),
// never in the web page.

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
const MAX_CHARS = 12000;      // max size of one request from the page
const PER_MINUTE = 12;        // max AI requests per visitor per minute

const hits = new Map();       // simple best-effort rate limit per IP

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Missing ANTHROPIC_API_KEY" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0] || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
  if (recent.length >= PER_MINUTE) return res.status(429).json({ error: "Too many requests" });
  recent.push(now); hits.set(ip, recent);

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : null;
  if (!messages || !messages.length) return res.status(400).json({ error: "No messages" });
  const clean = messages
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content }));
  if (!clean.length || clean[clean.length - 1].role !== "user") return res.status(400).json({ error: "Bad messages" });
  if (JSON.stringify(clean).length > MAX_CHARS) return res.status(413).json({ error: "Request too long" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 800, messages: clean })
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Anthropic error", r.status, data);
      return res.status(r.status === 429 ? 429 : 502).json({ error: "AI error" });
    }
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    return res.status(200).json({ text });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "AI unreachable" });
  }
}
