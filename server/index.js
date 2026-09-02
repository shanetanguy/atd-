import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.js";
import { uploadPhoto } from "./r2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 5174;
const JWT_SECRET = process.env.JWT_SECRET || "dev-insecure-secret-change-me";
const STAFF_PASSWORD = process.env.ATD_STAFF_PASSWORD || "atd-dev-only";

if (!process.env.JWT_SECRET) {
  console.warn("[atd] JWT_SECRET is not set — using an insecure default. Set it before deploying.");
}
if (!process.env.ATD_STAFF_PASSWORD) {
  console.warn("[atd] ATD_STAFF_PASSWORD is not set — using an insecure default. Set it before deploying.");
}

const db = getDb();
const app = express();
app.use(cors());
// Photos now go through /api/uploads and are stored on R2, so report bodies
// only carry text fields + photo URLs; the limit just needs headroom for one
// resized photo upload at a time.
app.use(express.json({ limit: "6mb" }));

function requireStaff(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing session token" });
  try {
    req.staff = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== "string" || password.length === 0 || password !== STAFF_PASSWORD) {
    return res.status(401).json({ error: "Incorrect password" });
  }
  const token = jwt.sign({ role: "staff" }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token });
});

// Staff-only: resize happens client-side; this just persists the result to R2
// and hands back a permanent URL to store on the report instead of the data URL.
app.post("/api/uploads", requireStaff, async (req, res) => {
  const { dataUrl } = req.body || {};
  const match = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/(?:jpeg|png));base64,(.+)$/);
  if (!match) return res.status(400).json({ error: "Invalid image" });
  const [, contentType, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  try {
    const url = await uploadPhoto(buffer, contentType);
    res.json({ url });
  } catch (e) {
    console.error("[atd] photo upload failed:", e.message);
    res.status(500).json({ error: "Photo upload failed" });
  }
});

// Staff-only: full list for the dashboard.
app.get("/api/reports", requireStaff, (req, res) => {
  const rows = db.prepare("SELECT data FROM reports ORDER BY created_at ASC").all();
  const index = rows.map((row) => {
    const r = JSON.parse(row.data);
    return { id: r.id, make: r.make, reg: r.reg, reportType: r.reportType, date: r.date, status: r.status };
  });
  res.json(index);
});

// Public: this is the "magic link" a client opens (/sign/:id) or types a code for.
// The report id doubles as an access capability, same as the original prototype's design.
app.get("/api/reports/:id", (req, res) => {
  const row = db.prepare("SELECT data FROM reports WHERE id = ?").get(req.params.id.toUpperCase());
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(JSON.parse(row.data));
});

app.post("/api/reports", requireStaff, (req, res) => {
  const report = req.body;
  if (!report || typeof report.id !== "string") return res.status(400).json({ error: "Invalid report" });
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO reports (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(report.id, JSON.stringify(report), now, now);
  res.json(report);
});

// Public: the client's confirm/dispute sign-off. No staff auth — the report id is the capability.
app.post("/api/reports/:id/respond", (req, res) => {
  const row = db.prepare("SELECT data FROM reports WHERE id = ?").get(req.params.id.toUpperCase());
  if (!row) return res.status(404).json({ error: "Not found" });
  const report = JSON.parse(row.data);
  const { decision, name, comment, signature } = req.body || {};
  if (
    !["confirmed", "disputed"].includes(decision) ||
    typeof name !== "string" || !name.trim() ||
    typeof signature !== "string" || !signature.startsWith("data:image/")
  ) {
    return res.status(400).json({ error: "Invalid response" });
  }
  report.status = decision;
  report.clientResponse = {
    decision,
    name: name.trim(),
    comment: typeof comment === "string" ? comment : "",
    signature,
    date: new Date().toISOString(),
  };
  db.prepare("UPDATE reports SET data = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(report),
    new Date().toISOString(),
    report.id
  );
  res.json(report);
});

// In production, serve the built frontend from the same origin/port as the API
// so there's no CORS to worry about and /sign/:id deep links resolve correctly.
const distDir = path.join(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => console.log(`[atd] server listening on :${PORT}`));
