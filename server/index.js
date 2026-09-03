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
// A separate, stronger password for admin sign-in — same login screen, but
// this password grants the "admin" role instead of "staff", which is what
// unlocks deleting inspections. No admin password set means deleting is off.
const ADMIN_PASSWORD = process.env.ATD_ADMIN_PASSWORD || null;

if (!process.env.JWT_SECRET) {
  console.warn("[atd] JWT_SECRET is not set — using an insecure default. Set it before deploying.");
}
if (!process.env.ATD_STAFF_PASSWORD) {
  console.warn("[atd] ATD_STAFF_PASSWORD is not set — using an insecure default. Set it before deploying.");
}
if (!ADMIN_PASSWORD) {
  console.warn("[atd] ATD_ADMIN_PASSWORD is not set — admin sign-in (needed to delete inspections) is disabled.");
}

const VEHICLE_FIELDS = [
  "make", "colour", "year", "clientType", "clientName", "trustCompany",
  "contactEmail", "contactPhone", "beneficialOwner", "vatSitus", "bay",
];

function genId(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function normalizeCode(v) {
  return (v || "").replace(/\s+/g, "").toUpperCase();
}

// Links a report to a vehicle record, so later checks on the same car can
// look its details up instead of retyping them. A VIN never changes, but a
// registration can be reused or transferred between cars — so a VIN match
// is preferred, and registration is only used as a fallback for reports
// that don't carry a VIN (routine checks won't always have one scanned).
// Matches an existing vehicle (or uses the report's own vehicleId, if it
// already has one) rather than always creating a new one, and only ever
// fills in fields the vehicle doesn't already have — a sparse later report
// (e.g. a routine check with the trust company left blank) never erases
// data a fuller one already established.
function linkVehicle(db, report) {
  const vinKey = normalizeCode(report.vin);
  const regKey = normalizeCode(report.reg);
  if (!vinKey && !regKey) return null;

  const now = new Date().toISOString();
  let vehicle = null;

  if (report.vehicleId) {
    const row = db.prepare("SELECT data FROM vehicles WHERE id = ?").get(report.vehicleId);
    if (row) vehicle = JSON.parse(row.data);
  }
  if (!vehicle) {
    const all = db.prepare("SELECT data FROM vehicles").all().map((r) => JSON.parse(r.data));
    const match =
      (vinKey && all.find((v) => normalizeCode(v.vin) === vinKey)) ||
      (regKey && all.find((v) => normalizeCode(v.reg) === regKey)) ||
      null;
    vehicle = match || { id: genId(), createdAt: now };
  }

  for (const field of VEHICLE_FIELDS) {
    if (report[field]) vehicle[field] = report[field];
  }
  if (report.reg) vehicle.reg = report.reg;
  if (report.vin) vehicle.vin = report.vin;

  // Snapshot intake-time reference data onto the vehicle record so later
  // Routine/Release reports (and a future Intake, if this car comes back)
  // can look up "what did we record at intake" without a separate fetch.
  if (report.reportType === "Intake") {
    vehicle.intakeReportId = report.id;
    vehicle.intakeDate = report.date;
    vehicle.intakeTyres = report.tyres;
    vehicle.intakeItems = report.items;
    vehicle.intakePins = report.pins;
    vehicle.intakeInteriorPins = report.interiorPins;
  }

  db.prepare(
    `INSERT INTO vehicles (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(vehicle.id, JSON.stringify(vehicle), vehicle.createdAt || now, now);

  return vehicle.id;
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

function requireAdmin(req, res, next) {
  requireStaff(req, res, () => {
    if (req.staff.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    next();
  });
}

app.post("/api/auth/login", (req, res) => {
  const { password } = req.body || {};
  let role = null;
  if (typeof password === "string" && password.length > 0) {
    if (ADMIN_PASSWORD && password === ADMIN_PASSWORD) role = "admin";
    else if (password === STAFF_PASSWORD) role = "staff";
  }
  if (!role) return res.status(401).json({ error: "Incorrect password" });
  const token = jwt.sign({ role }, JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, role });
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
  const vehicleId = linkVehicle(db, report);
  if (vehicleId) report.vehicleId = vehicleId;
  db.prepare(
    `INSERT INTO reports (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).run(report.id, JSON.stringify(report), now, now);
  res.json(report);
});

// Staff-only: every vehicle on file, for looking one up by registration to
// prefill a new report (or just browsing). Fine to return in full at this
// scale — no separate detail endpoint needed.
app.get("/api/vehicles", requireStaff, (req, res) => {
  const rows = db.prepare("SELECT data FROM vehicles ORDER BY updated_at DESC").all();
  res.json(rows.map((row) => JSON.parse(row.data)));
});

// Public: a vehicle's own code doubles as the capability, same as a report
// code. Only ever lists reports that have actually been sent for sign-off —
// drafts stay internal.
app.get("/api/vehicles/:id/documents", (req, res) => {
  const row = db.prepare("SELECT data FROM vehicles WHERE id = ?").get(req.params.id.toUpperCase());
  if (!row) return res.status(404).json({ error: "Not found" });
  const vehicle = JSON.parse(row.data);
  const reportRows = db.prepare("SELECT data FROM reports ORDER BY created_at DESC").all();
  const documents = reportRows
    .map((r) => JSON.parse(r.data))
    .filter((r) => r.vehicleId === vehicle.id && r.status !== "draft")
    .map((r) => ({ id: r.id, reportType: r.reportType, date: r.date, status: r.status }));
  res.json({ vehicle, documents });
});

// Admin-only: permanently removes an inspection.
app.delete("/api/reports/:id", requireAdmin, (req, res) => {
  const info = db.prepare("DELETE FROM reports WHERE id = ?").run(req.params.id.toUpperCase());
  if (info.changes === 0) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
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
