import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from "react";
import * as api from "./api.js";
import { CAR_ART_PATHS } from "./carArt.js";
import atdLogo from "./assets/atd-logo.png";
import interiorArt from "./assets/interior-diagram.jpg";
import {
  Camera, MapPin, Check, X, ChevronLeft, Plus, Link2, Trash2,
  Car, ClipboardList, Send, ShieldCheck, AlertTriangle, Loader2,
  ChevronRight, Copy, CheckCircle2, XCircle, Clock, FileText, Download,
  Armchair, ScanLine
} from "lucide-react";

const VinScannerModal = lazy(() => import("./VinScannerModal.jsx"));

/* ---------------------------------------------------------------
   ATD Automotive Storage — Inspection & Sign-off prototype
   Brand tokens
----------------------------------------------------------------*/
const NAVY = "#0B2545";
const NAVY_DEEP = "#071A33";
const STEEL = "#33547A";
const GOLD = "#B8933F";
const PAPER = "#F6F5F1";
const LINE = "#E3E1DA";
const INK = "#151515";
const OK_GREEN = "#2F7D4F";
const ISSUE_RED = "#B3261E";

const DAMAGE_CODES = [
  { code: "S", label: "Scratch", color: "#C9932F" },
  { code: "SC", label: "Scuff", color: "#B8730C" },
  { code: "RT", label: "Rip / Tear", color: "#B3261E" },
  { code: "ST", label: "Stained / Soiled", color: "#8E4EC6" },
  { code: "BM", label: "Broken / Missing Part", color: "#3A3A3A" },
];

// Codes used before the damage-type rename — not offered in the picker
// anymore, but kept here so pins saved under the old scheme still show
// their original label/color instead of silently relabeling as "Scratch".
const LEGACY_DAMAGE_CODES = [
  { code: "C", label: "Chip", color: "#B8730C" },
  { code: "D", label: "Dent", color: "#B3261E" },
  { code: "P", label: "Paint / Colour Loss", color: "#8E4EC6" },
  { code: "CR", label: "Crack", color: "#1B6FB8" },
  { code: "M", label: "Missing Part", color: "#3A3A3A" },
];

function damageCodeFor(code) {
  return (
    DAMAGE_CODES.find((d) => d.code === code) ||
    LEGACY_DAMAGE_CODES.find((d) => d.code === code) ||
    DAMAGE_CODES[0]
  );
}

// Pins carried forward from a vehicle's last intake (returning-car auto
// populate) are shown distinctly from damage marked fresh this visit, so
// staff never have to guess which is which: grey = already on file and
// still open, green = confirmed repaired since, normal damage-code colour
// = new this visit.
function pinColor(pin) {
  if (pin.origin === "carried") return pin.status === "repaired" ? OK_GREEN : STEEL;
  return damageCodeFor(pin.code).color;
}

// A green "already on file" hint shown next to an item field on a
// returning vehicle's new intake — the field itself is still editable
// (e.g. adding a new key to the count), this just shows what we already
// had recorded so staff aren't guessing what's expected back.
function HeldNote({ value }) {
  if (!value) return null;
  return <div className="text-[11px] mt-1" style={{ color: OK_GREEN }}>✓ Already held: {value}</div>;
}

// Item fields that carry a meaningful "count/held at intake" comparison —
// used both for Intake's HeldNote and Release's mismatch check below.
const ITEM_COMPARE_FIELDS = [
  "keysCount", "serviceBook", "spareWheel", "lockingWheelNut",
  "ownersManual", "trackerFobQty", "v5Doc", "chargingCable",
];

// A red flag shown on Release when what's being handed back doesn't match
// what intake recorded — doesn't block anything (staff can still override,
// e.g. a lost key), it just makes sure the discrepancy isn't silently
// missed and prompts the reason box below.
function MismatchNote({ current, held }) {
  if (!held || !current || held === current) return null;
  return (
    <div className="text-[11px] mt-1 flex items-center gap-1" style={{ color: ISSUE_RED }}>
      <AlertTriangle size={11} /> Intake recorded: {held}
    </div>
  );
}

// A Y/N field that only reveals a reason box when the answer is N — used
// on Routine for the run-up-to-temperature and mechanical-exercise checks.
function YesNoReasonField({ label, value, onChange, reason, onReasonChange }) {
  return (
    <div>
      <Field label={label.toUpperCase()}>
        <Select value={value} onChange={(v) => { onChange(v); if (v !== "N") onReasonChange(""); }} options={YN} />
      </Field>
      {value === "N" && (
        <Field label="REASON">
          <TextInput value={reason} onChange={onReasonChange} placeholder="Why not?" />
        </Field>
      )}
    </div>
  );
}

function PinOriginTag({ pin }) {
  if (pin.origin !== "carried") return null;
  const repaired = pin.status === "repaired";
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
      style={{ background: repaired ? "#E3F1E7" : "#E8E6DE", color: repaired ? OK_GREEN : STEEL }}
    >
      {repaired ? "Repaired" : "Existing"}
    </span>
  );
}

// Fields that carry over from a vehicle's past reports into a new one for
// the same car (matched by registration) — identity + client/trustee info
// that's stable across visits, not visit-specific condition data like
// odometer or fuel level. Mirrors VEHICLE_FIELDS on the server.
const VEHICLE_PREFILL_FIELDS = [
  "make", "colour", "year", "clientType", "clientName", "trustCompany",
  "contactEmail", "contactPhone", "beneficialOwner", "vatSitus", "bay",
];

function normalizeRegClient(reg) {
  return (reg || "").replace(/\s+/g, "").toUpperCase();
}

const YN = ["Y", "N"];
const FUEL_LEVELS = ["0%", "25%", "50%", "75%", "100%"];
const CLIENT_TYPES = ["Individual", "Trustee-Held"];
const REPORT_TYPES = ["Intake", "Routine", "Release"];
const CHECKLIST_STATUS = ["OK", "Issue", "Not Checked"];
const SPARE_WHEEL_OPTIONS = ["Y", "N", "Space-Saver"];
const V5_OPTIONS = ["Y", "N", "Held by Trustee"];
const CABLE_OPTIONS = ["Y", "N", "N/A"];
const CONDITION_OPTIONS = ["Clean", "Soiled"];
const CLEANED_OPTIONS = ["Cleaned", "Not Cleaned"];
const KEYS_OPTIONS = ["1", "2", "3", "4", "5"];
const TRACKER_FOB_OPTIONS = ["0", "1", "2", "3", "4"];

// Condition checklist differs by report type, matching ATD's own Intake and
// Handover/Release templates. Routine (no separate template) keeps the
// original lightweight periodic-check list.
const CHECKLIST_ITEMS = {
  Intake: [
    "Exterior paintwork — scratches, chips, marks",
    "Wheels & tyres — condition, damage, flat-spotting",
    "Glass & mirrors",
    "PPF / ceramic coating condition (if applied)",
    "Interior — upholstery, dash, odour",
    "Battery voltage / condition",
    "Fluid levels (oil, coolant, brake)",
    "Undertray / underbody — leaks, corrosion",
    "Alarm / immobiliser functioning",
    "Warning lights on dash",
  ],
  Release: [
    "Exterior paintwork — scratches, chips, marks",
    "Wheels & tyres — condition, damage",
    "Glass & mirrors",
    "Interior — upholstery, dash",
    "Any damage or marks noted on release",
  ],
  Routine: [
    "Wheels & tyres — condition / flat-spotting",
    "Battery voltage / conditioner status",
    "Alarm / immobiliser functioning",
    "Fluid leaks / drip tray check",
  ],
};

const TYRE_POSITIONS = [
  { key: "frontLeft", label: "Front Left" },
  { key: "frontRight", label: "Front Right" },
  { key: "rearLeft", label: "Rear Left" },
  { key: "rearRight", label: "Rear Right" },
  { key: "spare", label: "Spare (if applicable)" },
];

function blankTyres() {
  return Object.fromEntries(
    TYRE_POSITIONS.map((p) => [p.key, { factory: "", reading: "", reset: false, currentReading: "", newSetPressure: "" }])
  );
}

// Tyre pressures are free-text ("32 psi", "2.2 bar") so comparing them
// means pulling the first number out rather than assuming a fixed format.
function parsePsi(v) {
  const m = (v || "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Routine's current-reading field is colour-coded against what was set on
// intake: green if it's held (or only dropped a little), red once it's
// down more than 5psi — a null return means there's nothing to compare
// (no intake reading on file, or the field isn't a parseable number yet).
function tyreReadingColor(current, intakeReading) {
  const c = parsePsi(current);
  const i = parsePsi(intakeReading);
  if (c == null || i == null) return null;
  return c >= i - 5 ? OK_GREEN : ISSUE_RED;
}

function blankItems() {
  return {
    keysCount: "",
    serviceBook: "",
    spareWheel: "",
    lockingWheelNut: "",
    ownersManual: "",
    trackerFobQty: "",
    v5Doc: "",
    chargingCable: "",
    insuranceConfirmed: "",
    insuranceValidTo: "",
    motValidTo: "",
    conditionerMakeModel: "",
    batteryConditionerRemoved: "",
    ownConditionerReturned: "",
    otherItems: "",
  };
}

function genId(len = 6) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function blankReport() {
  return {
    id: genId(),
    createdAt: new Date().toISOString(),
    status: "draft", // draft | awaiting_signoff | confirmed | disputed
    reportType: "Routine",
    clientType: "Individual",
    date: todayISO(),
    inspectedBy: "",
    clientName: "",
    trustCompany: "",
    contactEmail: "",
    contactPhone: "",
    beneficialOwner: "",
    make: "",
    reg: "",
    vin: "",
    colour: "",
    year: "",
    odometer: "",
    vatSitus: "",
    bay: "",
    battery: "",
    ownConditioner: "",
    coverFitted: "",
    handbrake: "",
    fuel: "",
    // Intake only
    interiorCondition: "",
    interiorConditionCleaned: "",
    exteriorCondition: "",
    exteriorConditionCleaned: "",
    receivedFrom: "",
    handedOverBy: "",
    // Release only
    releasedTo: "",
    recipientName: "",
    idChecked: "",
    transportCo: "",
    driverName: "",
    collectionRef: "",
    itemDiscrepancyReason: "",
    // Routine only
    runUpToTemp: "",
    runUpToTempReason: "",
    mechanicalExercise: "",
    mechanicalExerciseReason: "",
    warningLights: "",
    actionRequired: "",
    actionAcknowledged: false,
    items: blankItems(),
    tyres: blankTyres(),
    checklist: {},
    pins: [],
    interiorPins: [],
    clientResponse: null,
  };
}

// Reports saved before the Intake/Release fields existed won't have items/
// tyres (or may have partial ones) — fill in defaults so the editor and
// client view never hit an undefined field on an older report.
function normalizeReport(r) {
  return {
    ...blankReport(),
    ...r,
    items: { ...blankItems(), ...(r.items || {}) },
    // Deep-merged per position — a shallow merge would drop new tyre
    // fields (currentReading, newSetPressure) entirely on any report saved
    // before they existed, since the old position object would win whole.
    tyres: Object.fromEntries(
      TYRE_POSITIONS.map((p) => [p.key, { ...blankTyres()[p.key], ...((r.tyres || {})[p.key] || {}) }])
    ),
    checklist: r.checklist || {},
    pins: r.pins || [],
    interiorPins: r.interiorPins || [],
  };
}

// Checklist entries were originally a plain "OK"/"Issue" string; now they're
// { status, note }. Reads either shape so older saved reports keep working.
function checklistEntry(report, item) {
  const v = report.checklist[item];
  if (!v) return { status: "", note: "" };
  if (typeof v === "string") return { status: v, note: "" };
  return { status: v.status || "", note: v.note || "" };
}

/* ---------------------------------------------------------------
   Image resize helper — keeps stored photos small
----------------------------------------------------------------*/
function resizeImage(file, maxW = 760) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------
   Small UI atoms
----------------------------------------------------------------*/
function TopBar({ title, onBack, right }) {
  return (
    <div className="relative sticky print:static top-0 z-20" style={{ background: NAVY, color: "white" }}>
      {onBack && (
        <button
          onClick={onBack}
          className="absolute left-2 top-3 p-1 rounded active:bg-white/10 print:hidden"
        >
          <ChevronLeft size={22} />
        </button>
      )}
      <div className="flex justify-center pt-3">
        <img src={atdLogo} alt="ATD Automotive Storage" className="h-10 w-auto print:h-12" />
      </div>
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-3">
        <div className="font-semibold text-base truncate">{title}</div>
        {right}
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const map = {
    draft: { label: "Draft", bg: "#E8E6DE", fg: "#5A5744", icon: FileText },
    awaiting_signoff: { label: "Awaiting sign-off", bg: "#FCEFD8", fg: "#8A5A10", icon: Clock },
    confirmed: { label: "Confirmed", bg: "#E3F1E7", fg: OK_GREEN, icon: CheckCircle2 },
    disputed: { label: "Disputed", bg: "#FBE7E5", fg: ISSUE_RED, icon: XCircle },
  };
  const s = map[status] || map.draft;
  const Icon = s.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium"
      style={{ background: s.bg, color: s.fg }}
    >
      <Icon size={12} /> {s.label}
    </span>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-3">
      <div className="text-xs font-semibold mb-1" style={{ color: STEEL }}>{label}</div>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border px-3 py-2.5 text-[15px] bg-white focus:outline-none focus:ring-2";
const inputStyle = { borderColor: LINE };

function Select({ value, onChange, options, placeholder = "Select…" }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputCls}
      style={{ ...inputStyle, color: value ? INK : "#9A968C" }}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o} style={{ color: INK }}>{o}</option>
      ))}
    </select>
  );
}

function TextInput({ value, onChange, onBlur, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      className={inputCls}
      style={inputStyle}
    />
  );
}

/* ---------------------------------------------------------------
   Car diagram — the source artwork shown whole, in one box, tap to drop a pin
----------------------------------------------------------------*/
const CANVAS_W = 640;

// The source artwork's own coordinate space is 792x612 — show it exactly as
// delivered, unmodified, in a single card rather than cropping it into pieces.
const ART_VB = { w: 792, h: 612 };
const CARD_PAD = 14;
const CARD_X = 14;
const CARD_Y = 14;
const CARD_W = CANVAS_W - CARD_X * 2;
const artX = CARD_X + CARD_PAD;
const artY = CARD_Y + CARD_PAD + 16;
const artW = CARD_W - CARD_PAD * 2;
const artScale = artW / ART_VB.w;
const artH = ART_VB.h * artScale;
const CARD_H = artH + CARD_PAD * 2 + 16;
const CANVAS_H = CARD_Y + CARD_H + CARD_Y;

// Hit-regions for tapping/placing pins, defined in the source artwork's own
// 792x612 coordinates, then converted to canvas coordinates below. front/
// roof/rear are x-thirds of the plan-view band (one continuous drawing);
// "side" is the one side-profile drawing the source art contains — the
// artwork doesn't have a separate left/right pair to mirror, so damage on
// either side gets marked on this same picture.
const SOURCE_ZONES = {
  front: { x: 133, y: 93, w: 167, h: 172 },
  roof: { x: 300, y: 93, w: 195, h: 172 },
  rear: { x: 495, y: 93, w: 168, h: 172 },
  side: { x: 133, y: 350, w: 530, h: 172 },
};

function toCanvas(zone) {
  return {
    x: artX + zone.x * artScale,
    y: artY + zone.y * artScale,
    w: zone.w * artScale,
    h: zone.h * artScale,
  };
}

const PANELS = Object.fromEntries(Object.entries(SOURCE_ZONES).map(([k, z]) => [k, toCanvas(z)]));

function panelLabel(key) {
  return { front: "Front", rear: "Rear", roof: "Roof", side: "Side" }[key];
}

function CarDiagram({ pins, onAddPin, readOnly, activePinId, onSelectPin }) {
  const svgRef = useRef(null);

  const handleTap = (e) => {
    if (readOnly) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = ((clientX - rect.left) / rect.width) * CANVAS_W;
    const py = ((clientY - rect.top) / rect.height) * CANVAS_H;

    let hit = null;
    for (const [key, p] of Object.entries(PANELS)) {
      if (px >= p.x && px <= p.x + p.w && py >= p.y && py <= p.y + p.h) { hit = key; break; }
    }
    if (!hit) return;
    const p = PANELS[hit];
    const x = ((px - p.x) / p.w) * 100;
    const y = ((py - p.y) / p.h) * 100;
    onAddPin(hit, x, y);
  };

  return (
    <div className="relative select-none" style={{ touchAction: "manipulation" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        onClick={handleTap}
        className="w-full h-auto rounded-xl"
        style={{ background: "white", border: `1px solid ${LINE}`, cursor: readOnly ? "default" : "crosshair" }}
      >
        <defs>
          <g id="atd-car-art" fill={NAVY} dangerouslySetInnerHTML={{ __html: CAR_ART_PATHS }} />
        </defs>

        <rect x={CARD_X} y={CARD_Y} width={CARD_W} height={CARD_H} rx="12" fill="white" stroke={LINE} strokeWidth="1.5" />
        <text x={artX} y={CARD_Y + CARD_PAD + 9} fontSize="11" fill={STEEL} fontWeight="600">VEHICLE DIAGRAM</text>

        {/* the whole source artwork, unmodified — no cropping, no mirroring */}
        <svg x={artX} y={artY} width={artW} height={artH} viewBox={`0 0 ${ART_VB.w} ${ART_VB.h}`} overflow="hidden">
          <use href="#atd-car-art" />
        </svg>

        {pins.map((pin) => {
          const p = PANELS[pin.panel];
          if (!p) return null;
          const cx = p.x + (pin.x / 100) * p.w;
          const cy = p.y + (pin.y / 100) * p.h;
          const isActive = activePinId === pin.id;
          return (
            <g
              key={pin.id}
              transform={`translate(${cx}, ${cy})`}
              onClick={(e) => { e.stopPropagation(); onSelectPin && onSelectPin(pin.id); }}
              style={{ cursor: "pointer" }}
            >
              <circle r={isActive ? 14 : 11} fill={pinColor(pin)} stroke="white" strokeWidth="2.5" />
              <text y="4" fontSize="10" fill="white" textAnchor="middle" fontWeight="700">
                {pin.code}{pin.number}
              </text>
            </g>
          );
        })}
      </svg>
      {!readOnly && (
        <div className="text-center text-xs mt-2" style={{ color: STEEL }}>
          Tap any panel — front, roof, rear, or side — to mark a point of damage
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Interior diagram — a single reference photo, tap anywhere on it
   to drop a pin. Unlike the exterior diagram there's no natural set
   of panels to zone-hit against, so this is just one full-image box.
----------------------------------------------------------------*/
const INTERIOR_IMG = { w: 1800, h: 1051 };
const iCardPad = 14;
const iCardX = 14;
const iCardY = 14;
const iCardW = CANVAS_W - iCardX * 2;
const interiorArtX = iCardX + iCardPad;
const interiorArtY = iCardY + iCardPad + 16;
const interiorArtW = iCardW - iCardPad * 2;
const interiorArtScale = interiorArtW / INTERIOR_IMG.w;
const interiorArtH = INTERIOR_IMG.h * interiorArtScale;
const iCardH = interiorArtH + iCardPad * 2 + 16;
const INTERIOR_CANVAS_H = iCardY + iCardH + iCardY;

function InteriorDiagram({ pins, onAddPin, readOnly, activePinId, onSelectPin }) {
  const svgRef = useRef(null);

  const handleTap = (e) => {
    if (readOnly) return;
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const px = ((clientX - rect.left) / rect.width) * CANVAS_W;
    const py = ((clientY - rect.top) / rect.height) * INTERIOR_CANVAS_H;

    if (px < interiorArtX || px > interiorArtX + interiorArtW || py < interiorArtY || py > interiorArtY + interiorArtH) return;
    const x = ((px - interiorArtX) / interiorArtW) * 100;
    const y = ((py - interiorArtY) / interiorArtH) * 100;
    onAddPin(x, y);
  };

  return (
    <div className="relative select-none" style={{ touchAction: "manipulation" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CANVAS_W} ${INTERIOR_CANVAS_H}`}
        onClick={handleTap}
        className="w-full h-auto rounded-xl"
        style={{ background: "white", border: `1px solid ${LINE}`, cursor: readOnly ? "default" : "crosshair" }}
      >
        <rect x={iCardX} y={iCardY} width={iCardW} height={iCardH} rx="12" fill="white" stroke={LINE} strokeWidth="1.5" />
        <text x={interiorArtX} y={iCardY + iCardPad + 9} fontSize="11" fill={STEEL} fontWeight="600">INTERIOR DIAGRAM</text>
        <image
          href={interiorArt}
          x={interiorArtX}
          y={interiorArtY}
          width={interiorArtW}
          height={interiorArtH}
          preserveAspectRatio="xMidYMid meet"
        />

        {pins.map((pin) => {
          const cx = interiorArtX + (pin.x / 100) * interiorArtW;
          const cy = interiorArtY + (pin.y / 100) * interiorArtH;
          const isActive = activePinId === pin.id;
          return (
            <g
              key={pin.id}
              transform={`translate(${cx}, ${cy})`}
              onClick={(e) => { e.stopPropagation(); onSelectPin && onSelectPin(pin.id); }}
              style={{ cursor: "pointer" }}
            >
              <circle r={isActive ? 14 : 11} fill={pinColor(pin)} stroke="white" strokeWidth="2.5" />
              <text y="4" fontSize="10" fill="white" textAnchor="middle" fontWeight="700">
                {pin.code}{pin.number}
              </text>
            </g>
          );
        })}
      </svg>
      {!readOnly && (
        <div className="text-center text-xs mt-2" style={{ color: STEEL }}>
          Tap anywhere on the interior to mark a point of damage
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Pin editor sheet
----------------------------------------------------------------*/
function PinSheet({ pin, onSave, onDelete, onClose, inspectedBy }) {
  const [code, setCode] = useState(pin.code || "S");
  const [note, setNote] = useState(pin.note || "");
  const [photo, setPhoto] = useState(pin.photo || null);
  const [status, setStatus] = useState(pin.status || "open");
  const [busy, setBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const fileRef = useRef(null);
  const isCarried = pin.origin === "carried";

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setPhotoError("");
    try {
      const dataUrl = await resizeImage(file);
      const url = await api.uploadPhoto(dataUrl);
      setPhoto(url);
    } catch (err) {
      setPhotoError(err.message || "Couldn't upload photo. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center" style={{ background: "rgba(11,37,69,0.45)" }} onClick={onClose}>
      <div
        className="bg-white w-full max-w-md rounded-t-2xl p-5 pb-6"
        style={{ maxHeight: "88vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="font-semibold text-lg" style={{ color: NAVY }}>Damage point</div>
          <button onClick={onClose} className="p-1 rounded active:bg-black/5"><X size={20} /></button>
        </div>

        {isCarried && (
          <div
            className="mb-4 rounded-lg border p-3"
            style={{ borderColor: status === "repaired" ? OK_GREEN : LINE }}
          >
            <div className="text-xs font-semibold mb-2" style={{ color: STEEL }}>RECORDED AT INTAKE</div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStatus("open")}
                className="flex-1 rounded-lg py-2 text-xs font-semibold border-2"
                style={{
                  borderColor: status === "open" ? STEEL : LINE,
                  background: status === "open" ? `${STEEL}15` : "white",
                  color: status === "open" ? STEEL : INK,
                }}
              >
                Still present
              </button>
              <button
                type="button"
                onClick={() => setStatus("repaired")}
                className="flex-1 rounded-lg py-2 text-xs font-semibold border-2 flex items-center justify-center gap-1"
                style={{
                  borderColor: status === "repaired" ? OK_GREEN : LINE,
                  background: status === "repaired" ? `${OK_GREEN}15` : "white",
                  color: status === "repaired" ? OK_GREEN : INK,
                }}
              >
                <CheckCircle2 size={14} /> Mark repaired
              </button>
            </div>
            {status === "repaired" && (
              <div className="text-xs mt-2" style={{ color: OK_GREEN }}>
                Confirmed repaired{inspectedBy ? ` by ${inspectedBy}` : ""} — shows as a green point on the diagram.
              </div>
            )}
          </div>
        )}

        <div className="text-xs font-semibold mb-2" style={{ color: STEEL }}>TYPE</div>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {DAMAGE_CODES.map((d) => (
            <button
              key={d.code}
              onClick={() => setCode(d.code)}
              className="rounded-lg py-2 text-xs font-semibold border-2 flex flex-col items-center gap-1"
              style={{
                borderColor: code === d.code ? d.color : LINE,
                background: code === d.code ? `${d.color}15` : "white",
                color: code === d.code ? d.color : INK,
              }}
            >
              <span className="text-base font-bold">{d.code}</span>
              {d.label}
            </button>
          ))}
        </div>

        <Field label="NOTES">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="e.g. 4cm scratch above rear wheel arch"
            className={inputCls}
            style={inputStyle}
          />
        </Field>

        <div className="text-xs font-semibold mb-2" style={{ color: STEEL }}>PHOTO</div>
        {photo ? (
          <div className="relative mb-3">
            <img src={photo} alt="damage" className="w-full rounded-lg object-cover" style={{ maxHeight: 220 }} />
            <button
              onClick={() => setPhoto(null)}
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="w-full mb-3 rounded-lg border-2 border-dashed py-6 flex flex-col items-center gap-2 text-sm"
            style={{ borderColor: LINE, color: STEEL }}
          >
            {busy ? <Loader2 size={22} className="animate-spin" /> : <Camera size={22} />}
            {busy ? "Uploading…" : "Take or add a photo"}
          </button>
        )}
        {photoError && (
          <div className="text-xs -mt-2 mb-3" style={{ color: ISSUE_RED }}>{photoError}</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handlePhoto}
          className="hidden"
        />

        <div className="flex gap-2 mt-2">
          <button
            onClick={() => onDelete(pin.id)}
            className="flex-1 rounded-lg py-3 text-sm font-semibold border flex items-center justify-center gap-1.5"
            style={{ borderColor: ISSUE_RED, color: ISSUE_RED }}
          >
            <Trash2 size={16} /> Remove
          </button>
          <button
            onClick={() => onSave({
              ...pin,
              code,
              note,
              photo,
              ...(isCarried
                ? {
                    status,
                    repairedBy: status === "repaired" ? (pin.repairedBy || inspectedBy || "") : undefined,
                    repairedAt: status === "repaired" ? (pin.repairedAt || new Date().toISOString()) : undefined,
                  }
                : {}),
            })}
            className="flex-1 rounded-lg py-3 text-sm font-semibold text-white"
            style={{ background: NAVY }}
          >
            Save point
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Staff login — gates the inspection tooling. Clients never see
   this: they open a /sign/<code> link or enter a code directly.
----------------------------------------------------------------*/
function LoginScreen({ onLoggedIn, onViewByCode }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      const { role } = await api.login(password);
      const idx = await api.fetchIndex();
      onLoggedIn(idx, role);
    } catch (err) {
      setError(err.message || "Incorrect password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <TopBar title="Staff Sign In" />
      <form onSubmit={submit} className="p-5">
        <div className="text-center mb-6 mt-2">
          <ShieldCheck size={30} className="mx-auto mb-3" style={{ color: NAVY }} />
          <div className="font-semibold text-lg" style={{ color: NAVY }}>Staff access</div>
          <div className="text-sm mt-1" style={{ color: STEEL }}>
            Enter the ATD staff password to manage inspections.
          </div>
        </div>
        <Field label="PASSWORD">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputCls}
            style={inputStyle}
            autoFocus
          />
        </Field>
        {error && (
          <div className="text-sm mb-3 flex items-start gap-2" style={{ color: ISSUE_RED }}>
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !password}
          className="w-full rounded-xl py-3.5 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
          style={{ background: NAVY }}
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : null}
          Sign in
        </button>
        <button
          type="button"
          onClick={onViewByCode}
          className="w-full mt-3 text-sm font-medium"
          style={{ color: STEEL }}
        >
          Have a report code from ATD instead? View it here
        </button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------
   Generic confirm dialog — used for destructive admin actions
----------------------------------------------------------------*/
function ConfirmDialog({ title, message, confirmLabel = "Delete", onConfirm, onCancel, busy }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(11,37,69,0.45)" }}
      onClick={onCancel}
    >
      <div className="bg-white w-full max-w-sm rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="font-semibold text-lg mb-2" style={{ color: NAVY }}>{title}</div>
        <div className="text-sm mb-5" style={{ color: STEEL }}>{message}</div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-lg py-3 text-sm font-semibold border disabled:opacity-60"
            style={{ borderColor: LINE, color: NAVY }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 rounded-lg py-3 text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
            style={{ background: ISSUE_RED }}
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Dashboard
----------------------------------------------------------------*/
function Dashboard({ index, onNew, onOpen, onClientAccess, onLogout, isAdmin, onDelete }) {
  const [confirmId, setConfirmId] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const confirmTarget = confirmId ? index.find((r) => r.id === confirmId) : null;

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError("");
    try {
      await onDelete(confirmId);
      setConfirmId(null);
    } catch (err) {
      setDeleteError(err.message || "Couldn't delete this inspection. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <TopBar
        title="Inspections"
        right={
          <button
            onClick={onLogout}
            className="text-xs font-medium px-2 py-1 rounded active:bg-white/10"
            style={{ color: "white" }}
          >
            Sign out
          </button>
        }
      />
      <div className="p-4">
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={onNew}
            className="rounded-xl p-4 text-white flex flex-col items-start gap-2"
            style={{ background: NAVY }}
          >
            <Plus size={20} />
            <span className="text-sm font-semibold text-left">New Inspection</span>
          </button>
          <button
            onClick={onClientAccess}
            className="rounded-xl p-4 flex flex-col items-start gap-2 border"
            style={{ borderColor: LINE, color: NAVY }}
          >
            <Link2 size={20} />
            <span className="text-sm font-semibold text-left">Client Access</span>
          </button>
        </div>

        <div className="text-xs font-semibold tracking-wide mb-2" style={{ color: STEEL }}>
          RECENT REPORTS
        </div>

        {deleteError && (
          <div className="text-sm mb-3 flex items-start gap-2" style={{ color: ISSUE_RED }}>
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {deleteError}
          </div>
        )}

        {index.length === 0 && (
          <div className="text-center py-16 rounded-xl border" style={{ borderColor: LINE, color: STEEL }}>
            <ClipboardList size={28} className="mx-auto mb-2 opacity-50" />
            <div className="text-sm">No inspections yet.</div>
            <div className="text-xs mt-1">Start a new inspection to get going.</div>
          </div>
        )}

        <div className="space-y-2">
          {index.slice().reverse().map((r) => (
            <div
              key={r.id}
              className="bg-white rounded-xl border flex items-stretch"
              style={{ borderColor: LINE }}
            >
              <button
                onClick={() => onOpen(r.id)}
                className="flex-1 min-w-0 text-left p-3.5 flex items-center justify-between"
              >
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate" style={{ color: INK }}>
                    {r.make || "Untitled vehicle"} {r.reg ? `· ${r.reg}` : ""}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: STEEL }}>
                    {r.reportType} · {r.date} · ref {r.id}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <StatusChip status={r.status} />
                  <ChevronRight size={16} style={{ color: STEEL }} />
                </div>
              </button>
              {isAdmin && (
                <button
                  onClick={() => setConfirmId(r.id)}
                  aria-label="Delete inspection"
                  className="shrink-0 px-3 flex items-center justify-center border-l active:bg-black/5"
                  style={{ borderColor: LINE, color: ISSUE_RED }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {confirmTarget && (
        <ConfirmDialog
          title="Delete this inspection?"
          message={`${confirmTarget.make || "Untitled vehicle"} ${confirmTarget.reg ? "· " + confirmTarget.reg : ""} (ref ${confirmTarget.id}) will be permanently deleted, including its sign-off link. This can't be undone.`}
          onCancel={() => setConfirmId(null)}
          onConfirm={handleDelete}
          busy={deleting}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Inspection editor
----------------------------------------------------------------*/
function InspectionEditor({ report, setReport, onBack, onOpenDiagram, onOpenInteriorDiagram, onSubmit, saving }) {
  const set = (k, v) => setReport((r) => ({ ...r, [k]: v }));
  const setChecklistField = (item, field, v) =>
    setReport((r) => ({
      ...r,
      checklist: { ...r.checklist, [item]: { ...checklistEntry(r, item), [field]: v } },
    }));
  const setItem = (k, v) => setReport((r) => ({ ...r, items: { ...r.items, [k]: v } }));
  const setTyre = (pos, field, v) =>
    setReport((r) => ({ ...r, tyres: { ...r.tyres, [pos]: { ...r.tyres[pos], [field]: v } } }));

  const isIntake = report.reportType === "Intake";
  const isRelease = report.reportType === "Release";
  const isRoutine = report.reportType === "Routine";
  const checklistItems = CHECKLIST_ITEMS[report.reportType] || CHECKLIST_ITEMS.Routine;

  // Vehicles this business has already seen — used to auto-fill this report
  // from a past one for the same car, so staff aren't retyping the client/
  // trustee/vehicle details every visit. A VIN never changes, but a
  // registration can be transferred between cars, so VIN is checked first;
  // registration is just a fallback for when no VIN's been entered yet.
  const [vehicles, setVehicles] = useState([]);
  const [vehicleNote, setVehicleNote] = useState("");
  const [scanningVin, setScanningVin] = useState(false);
  // Items this vehicle was recorded holding at its last intake — shown as a
  // green "already held" note next to the matching field on a returning
  // car's new intake, so staff see what's expected without re-entering it.
  const [heldItems, setHeldItems] = useState(null);
  // Tyre pressures recorded on this vehicle's last intake — referenced by
  // Routine's tyre pressure section to compare against today's reading.
  const [heldTyres, setHeldTyres] = useState(null);
  useEffect(() => {
    api.fetchVehicles().then(setVehicles).catch(() => {});
  }, []);

  // Intake: shows what's already on file (green). Release: flags when
  // what's being handed back doesn't match what intake recorded (red).
  const itemHint = (field) =>
    isIntake ? <HeldNote value={heldItems?.[field]} /> : isRelease ? <MismatchNote current={report.items[field]} held={heldItems?.[field]} /> : null;
  const hasItemMismatch =
    isRelease && !!heldItems && ITEM_COMPARE_FIELDS.some((f) => heldItems[f] && report.items[f] && heldItems[f] !== report.items[f]);

  const findVehicleMatch = (r) => {
    const vinKey = normalizeRegClient(r.vin);
    const regKey = normalizeRegClient(r.reg);
    return (
      (vinKey && vehicles.find((v) => normalizeRegClient(v.vin) === vinKey)) ||
      (regKey && vehicles.find((v) => normalizeRegClient(v.reg) === regKey)) ||
      null
    );
  };

  const applyVehicleMatch = (match) => {
    // A returning car with a prior intake — carry data from it forward
    // instead of starting from scratch. Items only prefill on a new
    // Intake (Release needs its own fresh count to compare against, not
    // a copy — see the mismatch check below); damage pins carry onto
    // the diagram on both Intake and Release, tagged "carried" so they
    // render distinctly from anything marked fresh today.
    const hasIntakeOnFile = !!match.intakeReportId;
    const carryItems = isIntake && hasIntakeOnFile;
    const carryPins = (isIntake || isRelease) && hasIntakeOnFile;
    if (match.intakeItems) setHeldItems(match.intakeItems); // Intake: prefill reference. Release: mismatch reference.
    if (match.intakeTyres) setHeldTyres(match.intakeTyres);

    setReport((r) => {
      const prefill = {};
      for (const field of VEHICLE_PREFILL_FIELDS) {
        if (!r[field] && match[field]) prefill[field] = match[field];
      }
      let items = r.items;
      let pins = r.pins;
      let interiorPins = r.interiorPins;
      if (carryItems && match.intakeItems) {
        items = { ...r.items };
        for (const k of Object.keys(items)) {
          if (!items[k] && match.intakeItems[k]) items[k] = match.intakeItems[k];
        }
      }
      if (carryPins) {
        if (r.pins.length === 0 && (match.intakePins || []).length > 0) {
          pins = match.intakePins.map((p) => ({ ...p, origin: "carried", status: p.status || "open" }));
        }
        if (r.interiorPins.length === 0 && (match.intakeInteriorPins || []).length > 0) {
          interiorPins = match.intakeInteriorPins.map((p) => ({ ...p, origin: "carried", status: p.status || "open" }));
        }
      }
      return { ...r, ...prefill, items, pins, interiorPins, vehicleId: match.id };
    });

    setVehicleNote(
      carryItems
        ? `Returning vehicle — loaded its details, held items, and damage from its last intake. Review before sending.`
        : carryPins
        ? `Loaded this vehicle's details and its damage diagram from intake — confirm each point and mark any new damage.`
        : `Loaded existing details for ${match.vin || match.reg} — check them before sending.`
    );
  };

  const handleVehicleFieldBlur = () => {
    if (report.vehicleId) return; // already linked to a vehicle — don't reassign mid-edit
    if (!report.vin && !report.reg) { setVehicleNote(""); return; }
    const match = findVehicleMatch(report);
    if (match) applyVehicleMatch(match);
    else setVehicleNote("New vehicle — its details will be saved for future checks.");
  };
  const handleRegBlur = handleVehicleFieldBlur;
  const handleVinBlur = handleVehicleFieldBlur;

  const handleVinScanned = (text) => {
    setScanningVin(false);
    setReport((r) => ({ ...r, vin: text }));
    if (report.vehicleId) return; // already linked — don't reassign mid-edit
    const match = findVehicleMatch({ ...report, vin: text });
    if (match) applyVehicleMatch(match);
    else setVehicleNote("New vehicle — its details will be saved for future checks.");
  };

  return (
    <div className="pb-28">
      <TopBar title="New Inspection" onBack={onBack} />
      <div className="p-4">
        <Section title="Report & Vehicle">
          <div className="grid grid-cols-2 gap-3">
            <Field label="REPORT TYPE">
              <Select value={report.reportType} onChange={(v) => set("reportType", v)} options={REPORT_TYPES} />
            </Field>
            <Field label="DATE">
              <TextInput value={report.date} onChange={(v) => set("date", v)} placeholder="YYYY-MM-DD" />
            </Field>
          </div>
          <Field label="INSPECTED BY">
            <TextInput value={report.inspectedBy} onChange={(v) => set("inspectedBy", v)} placeholder="Your name" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="CLIENT TYPE">
              <Select value={report.clientType} onChange={(v) => set("clientType", v)} options={CLIENT_TYPES} />
            </Field>
            <Field label="CLIENT NAME">
              <TextInput value={report.clientName} onChange={(v) => set("clientName", v)} placeholder="For sign-off" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="MAKE & MODEL">
              <TextInput value={report.make} onChange={(v) => set("make", v)} placeholder="e.g. Porsche 911" />
            </Field>
            <Field label="REGISTRATION">
              <TextInput value={report.reg} onChange={(v) => set("reg", v)} onBlur={handleRegBlur} placeholder="e.g. GY 1234" />
            </Field>
          </div>
          <Field label="VIN">
            <div className="flex gap-2">
              <TextInput value={report.vin} onChange={(v) => set("vin", v)} onBlur={handleVinBlur} placeholder="Vehicle Identification Number" />
              <button
                type="button"
                onClick={() => setScanningVin(true)}
                className="shrink-0 rounded-lg border px-3 flex items-center justify-center"
                style={{ borderColor: LINE, color: NAVY }}
                aria-label="Scan VIN barcode"
              >
                <ScanLine size={18} />
              </button>
            </div>
          </Field>
          {vehicleNote && (
            <div className="text-xs -mt-2 mb-3" style={{ color: STEEL }}>{vehicleNote}</div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="COLOUR">
              <TextInput value={report.colour} onChange={(v) => set("colour", v)} placeholder="e.g. Guards Red" />
            </Field>
            <Field label="YEAR">
              <TextInput value={report.year} onChange={(v) => set("year", v)} placeholder="e.g. 2022" />
            </Field>
          </div>
          <Field label="ODOMETER">
            <TextInput value={report.odometer} onChange={(v) => set("odometer", v)} placeholder="e.g. 12,400 mi" />
          </Field>
          {isIntake && (
            <Field label="VAT / SITUS STATUS">
              <TextInput value={report.vatSitus} onChange={(v) => set("vatSitus", v)} placeholder="e.g. VAT paid, EU situs" />
            </Field>
          )}
        </Section>

        {report.reportType !== "Routine" && (
          <Section title="Trustee / Client Details">
            <div className="grid grid-cols-2 gap-3">
              <Field label="TRUST / FIDUCIARY COMPANY">
                <TextInput value={report.trustCompany} onChange={(v) => set("trustCompany", v)} placeholder="If applicable" />
              </Field>
              <Field label="CONTACT EMAIL / PHONE">
                <TextInput value={report.contactEmail} onChange={(v) => set("contactEmail", v)} placeholder="Client contact" />
              </Field>
            </div>
            {isIntake && (
              <Field label="BENEFICIAL OWNER (IF DISCLOSED)">
                <TextInput value={report.beneficialOwner} onChange={(v) => set("beneficialOwner", v)} placeholder="Optional" />
              </Field>
            )}
          </Section>
        )}

        {isIntake && (
          <Section title="Intake Parties">
            <div className="grid grid-cols-2 gap-3">
              <Field label="RECEIVED FROM">
                <TextInput value={report.receivedFrom} onChange={(v) => set("receivedFrom", v)} placeholder="Owner / Trustee / Agent" />
              </Field>
              <Field label="HANDED OVER BY">
                <TextInput value={report.handedOverBy} onChange={(v) => set("handedOverBy", v)} placeholder="Name" />
              </Field>
            </div>
          </Section>
        )}

        {isRelease && (
          <Section title="Release Parties">
            <div className="grid grid-cols-2 gap-3">
              <Field label="RELEASED TO">
                <TextInput value={report.releasedTo} onChange={(v) => set("releasedTo", v)} placeholder="Owner / Trustee / Agent / Transport Co." />
              </Field>
              <Field label="RECIPIENT NAME">
                <TextInput value={report.recipientName} onChange={(v) => set("recipientName", v)} placeholder="Name" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ID CHECKED"><Select value={report.idChecked} onChange={(v) => set("idChecked", v)} options={YN} /></Field>
              <Field label="TRANSPORT / LOGISTICS CO.">
                <TextInput value={report.transportCo} onChange={(v) => set("transportCo", v)} placeholder="If applicable" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="DRIVER NAME">
                <TextInput value={report.driverName} onChange={(v) => set("driverName", v)} placeholder="If applicable" />
              </Field>
              <Field label="COLLECTION REF. / PO NO.">
                <TextInput value={report.collectionRef} onChange={(v) => set("collectionRef", v)} placeholder="Optional" />
              </Field>
            </div>
          </Section>
        )}

        <Section title="Storage Environment">
          <div className="grid grid-cols-2 gap-3">
            <Field label="STORAGE BAY">
              <TextInput value={report.bay} onChange={(v) => set("bay", v)} placeholder="e.g. B14" />
            </Field>
            <Field label="FUEL / CHARGE LEVEL">
              <Select value={report.fuel} onChange={(v) => set("fuel", v)} options={FUEL_LEVELS} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="BATTERY CONDITIONER"><Select value={report.battery} onChange={(v) => set("battery", v)} options={YN} /></Field>
            <Field label="OWN CONDITIONER SUPPLIED"><Select value={report.ownConditioner} onChange={(v) => set("ownConditioner", v)} options={YN} /></Field>
            <Field label="COVER FITTED"><Select value={report.coverFitted} onChange={(v) => set("coverFitted", v)} options={YN} /></Field>
            <Field label="HANDBRAKE OFF"><Select value={report.handbrake} onChange={(v) => set("handbrake", v)} options={YN} /></Field>
          </div>

          {isIntake && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="VEHICLE CONDITION ON ARRIVAL — INTERIOR">
                  <Select
                    value={report.interiorCondition}
                    onChange={(v) => setReport((r) => ({ ...r, interiorCondition: v, interiorConditionCleaned: v === "Soiled" ? r.interiorConditionCleaned : "" }))}
                    options={CONDITION_OPTIONS}
                  />
                </Field>
                <Field label="VEHICLE CONDITION ON ARRIVAL — EXTERIOR">
                  <Select
                    value={report.exteriorCondition}
                    onChange={(v) => setReport((r) => ({ ...r, exteriorCondition: v, exteriorConditionCleaned: v === "Soiled" ? r.exteriorConditionCleaned : "" }))}
                    options={CONDITION_OPTIONS}
                  />
                </Field>
              </div>
              {(report.interiorCondition === "Soiled" || report.exteriorCondition === "Soiled") && (
                <div className="grid grid-cols-2 gap-3">
                  {report.interiorCondition === "Soiled" && (
                    <Field label="INTERIOR CLEANED?">
                      <Select value={report.interiorConditionCleaned} onChange={(v) => set("interiorConditionCleaned", v)} options={CLEANED_OPTIONS} />
                    </Field>
                  )}
                  {report.exteriorCondition === "Soiled" && (
                    <Field label="EXTERIOR CLEANED?">
                      <Select value={report.exteriorConditionCleaned} onChange={(v) => set("exteriorConditionCleaned", v)} options={CLEANED_OPTIONS} />
                    </Field>
                  )}
                </div>
              )}
            </>
          )}
        </Section>

        {(isIntake || isRelease) && (
          <Section title={isIntake ? "Documents & Items Received" : "Documents & Items Returned"}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isIntake ? "KEYS / FOBS RECEIVED" : "KEYS / FOBS RETURNED"}>
                <Select value={report.items.keysCount} onChange={(v) => setItem("keysCount", v)} options={KEYS_OPTIONS} />
                {itemHint("keysCount")}
              </Field>
              <Field label={isIntake ? "SERVICE BOOK RECEIVED" : "SERVICE BOOK RETURNED"}>
                <Select value={report.items.serviceBook} onChange={(v) => setItem("serviceBook", v)} options={YN} />
                {itemHint("serviceBook")}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SPARE WHEEL PRESENT">
                <Select value={report.items.spareWheel} onChange={(v) => setItem("spareWheel", v)} options={SPARE_WHEEL_OPTIONS} />
                {itemHint("spareWheel")}
              </Field>
              <Field label="LOCKING WHEEL NUT KEY">
                <Select value={report.items.lockingWheelNut} onChange={(v) => setItem("lockingWheelNut", v)} options={YN} />
                {itemHint("lockingWheelNut")}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="OWNER'S MANUAL PRESENT">
                <Select value={report.items.ownersManual} onChange={(v) => setItem("ownersManual", v)} options={YN} />
                {itemHint("ownersManual")}
              </Field>
              <Field label="TRACKER FOB QUANTITY">
                <Select value={report.items.trackerFobQty} onChange={(v) => setItem("trackerFobQty", v)} options={TRACKER_FOB_OPTIONS} />
                {itemHint("trackerFobQty")}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="V5 / REGISTRATION DOC">
                <Select value={report.items.v5Doc} onChange={(v) => setItem("v5Doc", v)} options={V5_OPTIONS} />
                {itemHint("v5Doc")}
              </Field>
              <Field label="CHARGING CABLE (EV/HYBRID)">
                <Select value={report.items.chargingCable} onChange={(v) => setItem("chargingCable", v)} options={CABLE_OPTIONS} />
                {itemHint("chargingCable")}
              </Field>
            </div>
            {isIntake ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="INSURANCE CONFIRMED"><Select value={report.items.insuranceConfirmed} onChange={(v) => setItem("insuranceConfirmed", v)} options={YN} /></Field>
                  <Field label="INSURANCE VALID TO">
                    <TextInput value={report.items.insuranceValidTo} onChange={(v) => setItem("insuranceValidTo", v)} placeholder="YYYY-MM-DD" />
                  </Field>
                </div>
                <Field label="MOT / INSPECTION VALID TO">
                  <TextInput value={report.items.motValidTo} onChange={(v) => setItem("motValidTo", v)} placeholder="YYYY-MM-DD" />
                </Field>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="BATTERY CONDITIONER REMOVED"><Select value={report.items.batteryConditionerRemoved} onChange={(v) => setItem("batteryConditionerRemoved", v)} options={YN} /></Field>
                <Field label="INSURANCE CONFIRMED"><Select value={report.items.insuranceConfirmed} onChange={(v) => setItem("insuranceConfirmed", v)} options={YN} /></Field>
              </div>
            )}
            {isIntake ? (
              <Field label="CONDITIONER MAKE / MODEL">
                <TextInput value={report.items.conditionerMakeModel} onChange={(v) => setItem("conditionerMakeModel", v)} placeholder="If own conditioner supplied" />
              </Field>
            ) : (
              <Field label="OWN CONDITIONER RETURNED"><Select value={report.items.ownConditionerReturned} onChange={(v) => setItem("ownConditionerReturned", v)} options={CABLE_OPTIONS} /></Field>
            )}
            <Field label={isIntake ? "OTHER ITEMS RECEIVED" : "OTHER ITEMS HANDED OVER"}>
              <textarea
                value={report.items.otherItems}
                onChange={(e) => setItem("otherItems", e.target.value)}
                rows={2}
                placeholder="Car cover, tools, jack, tow eye, etc."
                className={inputCls}
                style={inputStyle}
              />
            </Field>

            {hasItemMismatch && (
              <div className="mt-3 rounded-lg border-2 p-3" style={{ borderColor: ISSUE_RED, background: "#FBE7E5" }}>
                <div className="text-xs font-semibold flex items-center gap-1.5" style={{ color: ISSUE_RED }}>
                  <AlertTriangle size={14} /> What's being handed back doesn't match intake
                </div>
                <Field label="REASON FOR DISCREPANCY *">
                  <textarea
                    value={report.itemDiscrepancyReason}
                    onChange={(e) => set("itemDiscrepancyReason", e.target.value)}
                    rows={2}
                    placeholder="e.g. Second key reported lost by client"
                    className={inputCls}
                    style={{ borderColor: ISSUE_RED }}
                  />
                </Field>
              </div>
            )}
          </Section>
        )}

        {(isIntake || isRelease) && (
          <Section title={isIntake ? "Factory Tyre Pressure Settings" : "Tyre Pressures — Reset to Factory"}>
            <div className="text-xs mb-3" style={{ color: STEEL }}>
              {isIntake
                ? "Record manufacturer factory settings on intake — use as the reference point when resetting pressures for release."
                : "Reference the factory settings recorded on the intake report. Confirm each position has been reset before release."}
            </div>
            {TYRE_POSITIONS.map((p) => (
              <div key={p.key} className="mb-3">
                <div className="text-xs font-semibold mb-1.5" style={{ color: INK }}>{p.label}</div>
                <div className="grid grid-cols-3 gap-2">
                  <TextInput value={report.tyres[p.key].factory} onChange={(v) => setTyre(p.key, "factory", v)} placeholder="Factory PSI/BAR" />
                  <TextInput
                    value={report.tyres[p.key].reading}
                    onChange={(v) => setTyre(p.key, "reading", v)}
                    placeholder={isIntake ? "Set on intake" : "Current PSI/BAR"}
                  />
                  {isRelease && (
                    <label className="flex items-center gap-2 text-xs rounded-lg border px-3" style={{ borderColor: LINE, color: STEEL }}>
                      <input type="checkbox" checked={report.tyres[p.key].reset} onChange={(e) => setTyre(p.key, "reset", e.target.checked)} />
                      Reset to factory
                    </label>
                  )}
                </div>
              </div>
            ))}
          </Section>
        )}

        {isRoutine && (
          <Section title="Tyre Pressures">
            <div className="text-xs mb-3" style={{ color: STEEL }}>
              {heldTyres
                ? "Reference is what was set on this vehicle's last intake. Current reading turns red if it's dropped more than 5psi below that."
                : "No intake reading on file for this vehicle yet — current readings won't be colour-checked."}
            </div>
            {TYRE_POSITIONS.map((p) => {
              const intakeReading = heldTyres?.[p.key]?.reading || "";
              const color = tyreReadingColor(report.tyres[p.key].currentReading, intakeReading);
              return (
                <div key={p.key} className="mb-3">
                  <div className="text-xs font-semibold mb-1.5" style={{ color: INK }}>{p.label}</div>
                  <div className="grid grid-cols-3 gap-2">
                    <div
                      className="rounded-lg border px-3 py-2.5 text-[15px] flex items-center"
                      style={{ borderColor: LINE, color: intakeReading ? INK : "#9A968C", background: "#F6F5F1" }}
                    >
                      {intakeReading || "Set on intake: —"}
                    </div>
                    <input
                      value={report.tyres[p.key].currentReading}
                      onChange={(e) => setTyre(p.key, "currentReading", e.target.value)}
                      placeholder="Current PSI/BAR"
                      className={inputCls}
                      style={{ borderColor: color || LINE, color: color || INK, fontWeight: color ? 600 : 400 }}
                    />
                    <TextInput value={report.tyres[p.key].newSetPressure} onChange={(v) => setTyre(p.key, "newSetPressure", v)} placeholder="New set pressure" />
                  </div>
                </div>
              );
            })}
          </Section>
        )}

        <Section title="Condition Checklist">
          {checklistItems.map((item) => {
            const entry = checklistEntry(report, item);
            return (
              <div key={item} className="py-2.5 border-b last:border-0" style={{ borderColor: LINE }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm pr-1" style={{ color: INK }}>{item}</div>
                  <div className="w-32 shrink-0">
                    <Select
                      value={entry.status}
                      onChange={(v) => setChecklistField(item, "status", v)}
                      options={CHECKLIST_STATUS}
                      placeholder="—"
                    />
                  </div>
                </div>
                <input
                  value={entry.note}
                  onChange={(e) => setChecklistField(item, "note", e.target.value)}
                  placeholder="Notes — e.g. which warning light, where the scratch is"
                  className="w-full mt-1.5 rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2"
                  style={inputStyle}
                />
              </div>
            );
          })}

          {isRoutine && (
            <div className="pt-3 mt-1 space-y-4">
              <YesNoReasonField
                label="Vehicle run up to temperature (60-day check)"
                value={report.runUpToTemp}
                onChange={(v) => set("runUpToTemp", v)}
                reason={report.runUpToTempReason}
                onReasonChange={(v) => set("runUpToTempReason", v)}
              />
              <YesNoReasonField
                label="Mechanical exercise carried out"
                value={report.mechanicalExercise}
                onChange={(v) => set("mechanicalExercise", v)}
                reason={report.mechanicalExerciseReason}
                onReasonChange={(v) => set("mechanicalExerciseReason", v)}
              />
              <Field label="WARNING LIGHTS">
                <TextInput value={report.warningLights} onChange={(v) => set("warningLights", v)} placeholder="None, or describe what's showing" />
              </Field>
            </div>
          )}
        </Section>

        {isRelease && (
          <div className="rounded-lg p-3 mb-5 text-xs" style={{ background: `${GOLD}15`, color: STEEL }}>
            By signing below, the recipient confirms they have inspected the vehicle and agree it is being released in the condition recorded on this report. ATD Automotive Detailing accepts no responsibility for any damage, fault, or missing item not noted above at the time of release.
          </div>
        )}

        {!isRoutine && (
          <Section title="Damage Diagram">
            <button
              onClick={onOpenDiagram}
              className="w-full rounded-xl border-2 p-4 flex items-center justify-between"
              style={{ borderColor: NAVY }}
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ background: `${NAVY}12` }}>
                  <Car size={22} style={{ color: NAVY }} />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm" style={{ color: NAVY }}>
                    {report.pins.length > 0 ? `${report.pins.length} point${report.pins.length > 1 ? "s" : ""} marked` : "Mark damage on diagram"}
                  </div>
                  <div className="text-xs" style={{ color: STEEL }}>Tap the car to add photos & pins</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: STEEL }} />
            </button>
          </Section>
        )}

        {!isRoutine && (
          <Section title="Interior Diagram">
            <button
              onClick={onOpenInteriorDiagram}
              className="w-full rounded-xl border-2 p-4 flex items-center justify-between"
              style={{ borderColor: NAVY }}
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg p-2" style={{ background: `${NAVY}12` }}>
                  <Armchair size={22} style={{ color: NAVY }} />
                </div>
                <div className="text-left">
                  <div className="font-semibold text-sm" style={{ color: NAVY }}>
                    {report.interiorPins.length > 0 ? `${report.interiorPins.length} point${report.interiorPins.length > 1 ? "s" : ""} marked` : "Mark interior condition"}
                  </div>
                  <div className="text-xs" style={{ color: STEEL }}>Tap the interior to add photos & pins</div>
                </div>
              </div>
              <ChevronRight size={18} style={{ color: STEEL }} />
            </button>
          </Section>
        )}

        {isRoutine && (
          <Section title="Action Required">
            <textarea
              value={report.actionRequired}
              onChange={(e) => set("actionRequired", e.target.value)}
              rows={3}
              placeholder="e.g. Fuel needed topping up, service due/overdue"
              className={inputCls}
              style={inputStyle}
            />
            <label className="flex items-start gap-2 text-sm mt-3" style={{ color: INK }}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={report.actionAcknowledged}
                onChange={(e) => set("actionAcknowledged", e.target.checked)}
              />
              I acknowledge the action(s) above{report.actionRequired ? "" : " (none noted)"}
            </label>
          </Section>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t" style={{ borderColor: LINE }}>
        <button
          onClick={onSubmit}
          disabled={saving}
          className="w-full rounded-xl py-3.5 text-white font-semibold flex items-center justify-center gap-2"
          style={{ background: NAVY }}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          {saving ? "Sending…" : "Send for client sign-off"}
        </button>
      </div>

      {scanningVin && (
        <Suspense fallback={
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "black" }}>
            <Loader2 size={26} className="animate-spin text-white" />
          </div>
        }>
          <VinScannerModal onDetected={handleVinScanned} onClose={() => setScanningVin(false)} />
        </Suspense>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <div
        className="text-xs font-bold tracking-wide mb-2 pb-1.5 border-b-2"
        style={{ color: NAVY, borderColor: NAVY }}
      >
        {title.toUpperCase()}
      </div>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------
   Diagram screen
----------------------------------------------------------------*/
function DiagramScreen({ report, setReport, onBack }) {
  const [activePinId, setActivePinId] = useState(null);
  const [nextNumbers, setNextNumbers] = useState({});

  const addPin = (panel, x, y) => {
    const id = genId(5);
    const count = (report.pins.filter((p) => p.code === "S").length) + 1;
    const newPin = { id, panel, x, y, code: "S", number: count, note: "", photo: null };
    setReport((r) => ({ ...r, pins: [...r.pins, newPin] }));
    setActivePinId(id);
  };

  const savePin = (updated) => {
    setReport((r) => {
      const codeCount = r.pins.filter((p) => p.code === updated.code && p.id !== updated.id).length;
      const numbered = { ...updated, number: r.pins.find(p => p.id === updated.id)?.code === updated.code
        ? updated.number
        : codeCount + 1 };
      return { ...r, pins: r.pins.map((p) => (p.id === updated.id ? numbered : p)) };
    });
    setActivePinId(null);
  };

  const deletePin = (id) => {
    setReport((r) => ({ ...r, pins: r.pins.filter((p) => p.id !== id) }));
    setActivePinId(null);
  };

  const activePin = report.pins.find((p) => p.id === activePinId);

  return (
    <div>
      <TopBar title="Damage Diagram" onBack={onBack} />
      <div className="p-4">
        <CarDiagram
          pins={report.pins}
          onAddPin={addPin}
          activePinId={activePinId}
          onSelectPin={setActivePinId}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {DAMAGE_CODES.map((d) => (
            <div key={d.code} className="flex items-center gap-1.5 text-xs">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: d.color }} />
              <span style={{ color: STEEL }}>{d.code} {d.label}</span>
            </div>
          ))}
        </div>

        {report.pins.length > 0 && (
          <div className="mt-5">
            <div className="text-xs font-semibold mb-2" style={{ color: STEEL }}>MARKED POINTS</div>
            <div className="space-y-2">
              {report.pins.map((p) => {
                const dc = damageCodeFor(p.code);
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePinId(p.id)}
                    className="w-full flex items-center gap-3 bg-white rounded-lg p-2.5 border text-left"
                    style={{ borderColor: LINE }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: pinColor(p) }}
                    >
                      {p.code}{p.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: INK }}>
                        {dc.label} · {panelLabel(p.panel)} <PinOriginTag pin={p} />
                      </div>
                      {p.note && <div className="text-xs truncate" style={{ color: STEEL }}>{p.note}</div>}
                    </div>
                    {p.photo && <Camera size={14} style={{ color: STEEL }} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {activePin && (
        <PinSheet
          pin={activePin}
          onSave={savePin}
          onDelete={deletePin}
          onClose={() => setActivePinId(null)}
          inspectedBy={report.inspectedBy}
        />
      )}
    </div>
  );
}

function InteriorDiagramScreen({ report, setReport, onBack }) {
  const [activePinId, setActivePinId] = useState(null);

  const addPin = (x, y) => {
    const id = genId(5);
    const count = (report.interiorPins.filter((p) => p.code === "S").length) + 1;
    const newPin = { id, x, y, code: "S", number: count, note: "", photo: null };
    setReport((r) => ({ ...r, interiorPins: [...r.interiorPins, newPin] }));
    setActivePinId(id);
  };

  const savePin = (updated) => {
    setReport((r) => {
      const codeCount = r.interiorPins.filter((p) => p.code === updated.code && p.id !== updated.id).length;
      const numbered = { ...updated, number: r.interiorPins.find(p => p.id === updated.id)?.code === updated.code
        ? updated.number
        : codeCount + 1 };
      return { ...r, interiorPins: r.interiorPins.map((p) => (p.id === updated.id ? numbered : p)) };
    });
    setActivePinId(null);
  };

  const deletePin = (id) => {
    setReport((r) => ({ ...r, interiorPins: r.interiorPins.filter((p) => p.id !== id) }));
    setActivePinId(null);
  };

  const activePin = report.interiorPins.find((p) => p.id === activePinId);

  return (
    <div>
      <TopBar title="Interior Diagram" onBack={onBack} />
      <div className="p-4">
        <InteriorDiagram
          pins={report.interiorPins}
          onAddPin={addPin}
          activePinId={activePinId}
          onSelectPin={setActivePinId}
        />

        <div className="mt-4 flex flex-wrap gap-2">
          {DAMAGE_CODES.map((d) => (
            <div key={d.code} className="flex items-center gap-1.5 text-xs">
              <span className="w-3 h-3 rounded-full inline-block" style={{ background: d.color }} />
              <span style={{ color: STEEL }}>{d.code} {d.label}</span>
            </div>
          ))}
        </div>

        {report.interiorPins.length > 0 && (
          <div className="mt-5">
            <div className="text-xs font-semibold mb-2" style={{ color: STEEL }}>MARKED POINTS</div>
            <div className="space-y-2">
              {report.interiorPins.map((p) => {
                const dc = damageCodeFor(p.code);
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePinId(p.id)}
                    className="w-full flex items-center gap-3 bg-white rounded-lg p-2.5 border text-left"
                    style={{ borderColor: LINE }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: pinColor(p) }}
                    >
                      {p.code}{p.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: INK }}>
                        {dc.label} · Interior <PinOriginTag pin={p} />
                      </div>
                      {p.note && <div className="text-xs truncate" style={{ color: STEEL }}>{p.note}</div>}
                    </div>
                    {p.photo && <Camera size={14} style={{ color: STEEL }} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {activePin && (
        <PinSheet
          pin={activePin}
          onSave={savePin}
          onDelete={deletePin}
          onClose={() => setActivePinId(null)}
          inspectedBy={report.inspectedBy}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------
   Shared link / submitted screen
----------------------------------------------------------------*/
function ShareScreen({ report, onBack, onDone }) {
  const [copied, setCopied] = useState(false);
  const [copiedVehicle, setCopiedVehicle] = useState(false);
  const link = `${window.location.origin}/sign/${report.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {}
  };

  const copyVehicle = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/vehicle/${report.vehicleId}`);
      setCopiedVehicle(true);
      setTimeout(() => setCopiedVehicle(false), 1800);
    } catch (e) {}
  };

  return (
    <div>
      <TopBar title="Sent for Sign-off" onBack={onBack} />
      <div className="p-5 flex flex-col items-center text-center">
        <div className="rounded-full p-4 mt-4 mb-4" style={{ background: `${OK_GREEN}15` }}>
          <ShieldCheck size={36} style={{ color: OK_GREEN }} />
        </div>
        <div className="font-semibold text-lg" style={{ color: NAVY }}>Report ready for {report.clientName || "your client"}</div>
        <div className="text-sm mt-1 max-w-xs" style={{ color: STEEL }}>
          Share this reference so they can review the diagram, photos and notes, then confirm or dispute.
        </div>

        <div
          className="w-full mt-6 rounded-xl border-2 border-dashed p-4 flex items-center justify-between gap-3"
          style={{ borderColor: NAVY }}
        >
          <div className="text-left min-w-0">
            <div className="text-[10px] font-semibold tracking-wide" style={{ color: STEEL }}>REPORT CODE</div>
            <div className="font-mono font-bold text-xl tracking-widest" style={{ color: NAVY }}>{report.id}</div>
          </div>
          <button
            onClick={copy}
            className="rounded-lg px-3 py-2 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
            style={{ background: NAVY }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div className="text-xs mt-3 px-2" style={{ color: STEEL }}>
          In this prototype, "sending" stores the report and gives you a code. In the full app this would be a real emailed/texted link the client can open directly, with no code to enter.
        </div>

        {report.vehicleId && (
          <>
            <div className="w-full mt-6 pt-6 border-t" style={{ borderColor: LINE }}>
              <div className="text-sm font-semibold" style={{ color: NAVY }}>This vehicle's document code</div>
              <div className="text-xs mt-1 max-w-xs mx-auto" style={{ color: STEEL }}>
                Share this once — your client can use it anytime to see every report sent for this car, not just this one.
              </div>
            </div>
            <div
              className="w-full mt-3 rounded-xl border-2 border-dashed p-4 flex items-center justify-between gap-3"
              style={{ borderColor: GOLD }}
            >
              <div className="text-left min-w-0">
                <div className="text-[10px] font-semibold tracking-wide" style={{ color: STEEL }}>VEHICLE CODE</div>
                <div className="font-mono font-bold text-xl tracking-widest" style={{ color: NAVY }}>{report.vehicleId}</div>
              </div>
              <button
                onClick={copyVehicle}
                className="rounded-lg px-3 py-2 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0"
                style={{ background: GOLD }}
              >
                {copiedVehicle ? <Check size={14} /> : <Copy size={14} />}
                {copiedVehicle ? "Copied" : "Copy"}
              </button>
            </div>
          </>
        )}

        <button
          onClick={onDone}
          className="w-full mt-8 rounded-xl py-3.5 font-semibold text-white"
          style={{ background: NAVY }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Client access — enter code
----------------------------------------------------------------*/
function ClientAccessScreen({ onBack, onFound, onFoundVehicle, initialError = "" }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    const c = code.trim().toUpperCase();
    try {
      try {
        const v = await api.fetchVehicleDocuments(c);
        onFoundVehicle(v);
        return;
      } catch (e) {
        // not a vehicle code — fall through and try it as a report code
      }
      const r = await api.fetchReport(c);
      onFound(r);
    } catch (e) {
      setError("No report or vehicle found for that code. Check with the sender and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <TopBar title="Client Access" onBack={onBack} />
      <div className="p-5">
        <div className="text-center mb-6 mt-2">
          <Link2 size={30} className="mx-auto mb-3" style={{ color: NAVY }} />
          <div className="font-semibold text-lg" style={{ color: NAVY }}>Enter your report or vehicle code</div>
          <div className="text-sm mt-1" style={{ color: STEEL }}>
            This simulates opening the link ATD sent you.
          </div>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. K7QX2M"
          className="w-full text-center tracking-[0.3em] font-mono font-bold text-lg rounded-xl border-2 py-3.5"
          style={{ borderColor: NAVY, color: NAVY }}
        />
        {error && (
          <div className="text-sm mt-3 flex items-start gap-2" style={{ color: ISSUE_RED }}>
            <AlertTriangle size={16} className="shrink-0 mt-0.5" /> {error}
          </div>
        )}
        <button
          onClick={lookup}
          disabled={loading}
          className="w-full mt-5 rounded-xl py-3.5 font-semibold text-white flex items-center justify-center gap-2"
          style={{ background: NAVY }}
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : null}
          View
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Vehicle document portal — a client opens this with their vehicle's own
   code (distinct from a single report's code) and sees every report ever
   sent for that car, not just one.
----------------------------------------------------------------*/
function VehicleDocumentsScreen({ vehicle, documents, onBack, onOpenDocument, loadingId }) {
  return (
    <div>
      <TopBar title="Vehicle Documents" onBack={onBack} />
      <div className="p-5">
        <div className="text-center mb-6 mt-2">
          <ClipboardList size={30} className="mx-auto mb-3" style={{ color: NAVY }} />
          <div className="font-semibold text-lg" style={{ color: NAVY }}>
            {vehicle.make || "Vehicle"} {vehicle.reg ? `· ${vehicle.reg}` : ""}
          </div>
          <div className="text-sm mt-1" style={{ color: STEEL }}>
            Every report ATD has sent for this vehicle.
          </div>
        </div>

        {documents.length === 0 && (
          <div className="text-center py-16 rounded-xl border" style={{ borderColor: LINE, color: STEEL }}>
            <ClipboardList size={28} className="mx-auto mb-2 opacity-50" />
            <div className="text-sm">No reports sent for this vehicle yet.</div>
          </div>
        )}

        <div className="space-y-2">
          {documents.map((d) => (
            <button
              key={d.id}
              onClick={() => onOpenDocument(d.id)}
              disabled={loadingId === d.id}
              className="w-full text-left bg-white rounded-xl p-3.5 border flex items-center justify-between"
              style={{ borderColor: LINE }}
            >
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate" style={{ color: INK }}>{d.reportType} Report</div>
                <div className="text-xs mt-0.5" style={{ color: STEEL }}>{d.date} · ref {d.id}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {loadingId === d.id ? <Loader2 size={16} className="animate-spin" style={{ color: STEEL }} /> : <StatusChip status={d.status} />}
                <ChevronRight size={16} style={{ color: STEEL }} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Signature pad — draw with mouse, touch, or pen (Pointer Events)
----------------------------------------------------------------*/
const SIG_W = 600;
const SIG_H = 180;

function SignaturePad({ onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);
  // Chromium can fire a spurious click (detail: 0, stale coordinates) on
  // whatever's below the canvas right after a pointerup that ends a drag —
  // here that's the Clear button. Ignore clicks that land within a beat of
  // finishing a stroke; a real tap on Clear always comes later than that.
  const lastEndAtRef = useRef(0);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current.getContext("2d");
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = NAVY;
  }, []);

  const posFromEvent = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const start = (e) => {
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = posFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    drawingRef.current = true;
  };

  const move = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const { x, y } = posFromEvent(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasDrawnRef.current) {
      hasDrawnRef.current = true;
      setHasSignature(true);
    }
  };

  const end = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastEndAtRef.current = Date.now();
    if (hasDrawnRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    if (Date.now() - lastEndAtRef.current < 400) return;
    const canvas = canvasRef.current;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasDrawnRef.current = false;
    setHasSignature(false);
    onChange(null);
  };

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={SIG_W}
          height={SIG_H}
          className="w-full rounded-lg border touch-none"
          style={{ borderColor: LINE, background: "white", height: 140, touchAction: "none" }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
        {!hasSignature && (
          <div className="absolute inset-0 flex items-center justify-center text-sm pointer-events-none" style={{ color: "#B8B4A8" }}>
            Sign here
          </div>
        )}
      </div>
      <button type="button" onClick={clear} className="text-xs mt-1.5 font-medium" style={{ color: STEEL }}>
        Clear signature
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------
   Client view — read only, confirm / dispute
----------------------------------------------------------------*/
function ClientViewScreen({ report, onBack, onRespond }) {
  const [decision, setDecision] = useState(null); // 'confirmed' | 'disputed'
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [signature, setSignature] = useState(null);
  const [saving, setSaving] = useState(false);
  const [viewPin, setViewPin] = useState(null);
  const [viewInteriorPin, setViewInteriorPin] = useState(null);

  const alreadyResponded = !!report.clientResponse;

  const submit = async () => {
    if (!name.trim() || !decision || !signature) return;
    setSaving(true);
    await onRespond({ decision, name: name.trim(), comment, signature, date: new Date().toISOString() });
    setSaving(false);
  };

  return (
    <div className="pb-6">
      <TopBar title="Vehicle Report" onBack={onBack} right={<StatusChip status={report.status} />} />
      <div className="p-4">
        <div className="bg-white rounded-xl border p-4 mb-4" style={{ borderColor: LINE }}>
          <div className="text-[10px] font-semibold tracking-wide" style={{ color: STEEL }}>{report.reportType?.toUpperCase()} REPORT</div>
          <div className="font-semibold text-lg" style={{ color: NAVY }}>{report.make || "Vehicle"} {report.reg && `· ${report.reg}`}</div>
          <div className="text-sm mt-0.5" style={{ color: STEEL }}>{report.date} · Ref {report.id} · Bay {report.bay || "—"}</div>
          {(report.colour || report.year || report.odometer) && (
            <div className="text-sm mt-0.5" style={{ color: STEEL }}>
              {[report.colour, report.year, report.odometer && `${report.odometer} odo`].filter(Boolean).join(" · ")}
            </div>
          )}
        </div>

        {report.reportType !== "Routine" && (
          <Section title="Damage Diagram">
            <CarDiagram pins={report.pins} readOnly activePinId={viewPin} onSelectPin={setViewPin} />
            <div className="mt-3 space-y-2">
              {report.pins.map((p) => {
                const dc = damageCodeFor(p.code);
                return (
                  <div key={p.id} className="bg-white rounded-lg p-2.5 border flex gap-3" style={{ borderColor: LINE }}>
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: pinColor(p) }}>
                      {p.code}{p.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>
                        {dc.label} · {panelLabel(p.panel)} <PinOriginTag pin={p} />
                      </div>
                      {p.note && <div className="text-xs mt-0.5" style={{ color: STEEL }}>{p.note}</div>}
                      {p.photo && (
                        <img src={p.photo} alt="" className="mt-2 rounded-md w-full max-w-[220px]" />
                      )}
                    </div>
                  </div>
                );
              })}
              {report.pins.length === 0 && (
                <div className="text-sm text-center py-4" style={{ color: STEEL }}>No damage marked on this report.</div>
              )}
            </div>
          </Section>
        )}

        {report.reportType !== "Routine" && (
          <Section title="Interior Diagram">
            <InteriorDiagram pins={report.interiorPins} readOnly activePinId={viewInteriorPin} onSelectPin={setViewInteriorPin} />
            <div className="mt-3 space-y-2">
              {report.interiorPins.map((p) => {
                const dc = damageCodeFor(p.code);
                return (
                  <div key={p.id} className="bg-white rounded-lg p-2.5 border flex gap-3" style={{ borderColor: LINE }}>
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: pinColor(p) }}>
                      {p.code}{p.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>
                        {dc.label} · Interior <PinOriginTag pin={p} />
                      </div>
                      {p.note && <div className="text-xs mt-0.5" style={{ color: STEEL }}>{p.note}</div>}
                      {p.photo && (
                        <img src={p.photo} alt="" className="mt-2 rounded-md w-full max-w-[220px]" />
                      )}
                    </div>
                  </div>
                );
              })}
              {report.interiorPins.length === 0 && (
                <div className="text-sm text-center py-4" style={{ color: STEEL }}>No interior damage marked on this report.</div>
              )}
            </div>
          </Section>
        )}

        {(CHECKLIST_ITEMS[report.reportType] || CHECKLIST_ITEMS.Routine).some((item) => checklistEntry(report, item).status) && (
          <Section title="Condition Checklist">
            <div className="space-y-1.5">
              {(CHECKLIST_ITEMS[report.reportType] || CHECKLIST_ITEMS.Routine).map((item) => {
                const entry = checklistEntry(report, item);
                if (!entry.status) return null;
                const statusColor = entry.status === "OK" ? OK_GREEN : entry.status === "Issue" ? ISSUE_RED : STEEL;
                const statusBg = entry.status === "OK" ? "#E3F1E7" : entry.status === "Issue" ? "#FBE7E5" : "#E8E6DE";
                return (
                  <div key={item} className="bg-white rounded-lg border px-3 py-2 print:break-inside-avoid" style={{ borderColor: LINE }}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm" style={{ color: INK }}>{item}</div>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: statusBg, color: statusColor }}
                      >
                        {entry.status}
                      </span>
                    </div>
                    {entry.note && <div className="text-xs mt-1" style={{ color: STEEL }}>{entry.note}</div>}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        <Section title="Condition Summary">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <SummaryRow label="Battery conditioner" value={report.battery} />
            <SummaryRow label="Own conditioner" value={report.ownConditioner} />
            <SummaryRow label="Cover fitted" value={report.coverFitted} />
            <SummaryRow label="Handbrake off" value={report.handbrake} />
            <SummaryRow label="Fuel / charge" value={report.fuel} />
            <SummaryRow label="Inspected by" value={report.inspectedBy} />
            {report.reportType === "Intake" && (
              <>
                <SummaryRow
                  label="Interior on arrival"
                  value={report.interiorCondition === "Soiled" && report.interiorConditionCleaned
                    ? `Soiled — ${report.interiorConditionCleaned}`
                    : report.interiorCondition}
                />
                <SummaryRow
                  label="Exterior on arrival"
                  value={report.exteriorCondition === "Soiled" && report.exteriorConditionCleaned
                    ? `Soiled — ${report.exteriorConditionCleaned}`
                    : report.exteriorCondition}
                />
              </>
            )}
          </div>
        </Section>

        {report.reportType === "Intake" && (
          <Section title="Intake Details">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryRow label="Received from" value={report.receivedFrom} />
              <SummaryRow label="Handed over by" value={report.handedOverBy} />
              <SummaryRow label="Keys / fobs received" value={report.items.keysCount} />
              <SummaryRow label="Service book" value={report.items.serviceBook} />
              <SummaryRow label="Spare wheel" value={report.items.spareWheel} />
              <SummaryRow label="Tracker fob qty" value={report.items.trackerFobQty} />
              <SummaryRow label="V5 / registration doc" value={report.items.v5Doc} />
              <SummaryRow label="Insurance confirmed" value={report.items.insuranceConfirmed} />
              <SummaryRow label="Insurance valid to" value={report.items.insuranceValidTo} />
              <SummaryRow label="MOT valid to" value={report.items.motValidTo} />
            </div>
            {report.items.otherItems && (
              <div className="mt-2 text-sm bg-white rounded-lg border p-2.5" style={{ borderColor: LINE, color: INK }}>
                <span className="font-semibold">Other items: </span>{report.items.otherItems}
              </div>
            )}
          </Section>
        )}

        {report.reportType === "Release" && (
          <Section title="Release Details">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryRow label="Released to" value={report.releasedTo} />
              <SummaryRow label="Recipient" value={report.recipientName} />
              <SummaryRow label="ID checked" value={report.idChecked} />
              <SummaryRow label="Keys / fobs returned" value={report.items.keysCount} />
              <SummaryRow label="Service book" value={report.items.serviceBook} />
              <SummaryRow label="Battery conditioner removed" value={report.items.batteryConditionerRemoved} />
              <SummaryRow label="Insurance confirmed" value={report.items.insuranceConfirmed} />
            </div>
            {report.items.otherItems && (
              <div className="mt-2 text-sm bg-white rounded-lg border p-2.5" style={{ borderColor: LINE, color: INK }}>
                <span className="font-semibold">Other items: </span>{report.items.otherItems}
              </div>
            )}
            {report.itemDiscrepancyReason && (
              <div className="mt-2 rounded-lg border-2 p-2.5 text-sm print:break-inside-avoid" style={{ borderColor: ISSUE_RED, background: "#FBE7E5", color: INK }}>
                <span className="font-semibold" style={{ color: ISSUE_RED }}>Discrepancy from intake: </span>{report.itemDiscrepancyReason}
              </div>
            )}
            <div className="rounded-lg p-3 mt-3 text-xs" style={{ background: `${GOLD}15`, color: STEEL }}>
              By confirming below, you agree the vehicle is being released in the condition recorded on this report. ATD Automotive Detailing accepts no responsibility for any damage, fault, or missing item not noted above at the time of release.
            </div>
          </Section>
        )}

        {report.reportType === "Routine" && (
          <Section title="Routine Check Details">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryRow
                label="Run up to temperature"
                value={report.runUpToTemp === "N" && report.runUpToTempReason ? `N — ${report.runUpToTempReason}` : report.runUpToTemp}
              />
              <SummaryRow
                label="Mechanical exercise"
                value={report.mechanicalExercise === "N" && report.mechanicalExerciseReason ? `N — ${report.mechanicalExerciseReason}` : report.mechanicalExercise}
              />
              <SummaryRow label="Warning lights" value={report.warningLights} />
            </div>

            {TYRE_POSITIONS.some((p) => report.tyres[p.key].currentReading || report.tyres[p.key].newSetPressure) && (
              <div className="mt-3">
                <div className="text-xs font-semibold mb-2" style={{ color: STEEL }}>TYRE PRESSURES</div>
                <div className="space-y-1.5">
                  {TYRE_POSITIONS.map((p) => {
                    const t = report.tyres[p.key];
                    if (!t.currentReading && !t.newSetPressure) return null;
                    return (
                      <div
                        key={p.key}
                        className="bg-white rounded-lg border px-3 py-2 flex items-center justify-between text-sm print:break-inside-avoid"
                        style={{ borderColor: LINE }}
                      >
                        <span style={{ color: INK }}>{p.label}</span>
                        <span style={{ color: STEEL }}>
                          {t.currentReading && `Current: ${t.currentReading}`}
                          {t.currentReading && t.newSetPressure ? " · " : ""}
                          {t.newSetPressure && `Set to: ${t.newSetPressure}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {report.actionRequired && (
              <div
                className="mt-3 rounded-lg p-3 text-sm print:break-inside-avoid"
                style={{ background: `${GOLD}15`, color: INK, borderLeft: `3px solid ${GOLD}` }}
              >
                <div className="font-semibold text-xs mb-1" style={{ color: STEEL }}>ACTION REQUIRED</div>
                {report.actionRequired}
                {report.actionAcknowledged && (
                  <div className="text-xs mt-1.5 flex items-center gap-1" style={{ color: OK_GREEN }}>
                    <Check size={12} /> Acknowledged by ATD staff
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {alreadyResponded ? (
          <div
            className="rounded-xl p-4 flex items-start gap-3 print:break-inside-avoid"
            style={{ background: report.clientResponse.decision === "confirmed" ? "#E3F1E7" : "#FBE7E5" }}
          >
            {report.clientResponse.decision === "confirmed"
              ? <CheckCircle2 size={20} style={{ color: OK_GREEN }} className="shrink-0 mt-0.5" />
              : <XCircle size={20} style={{ color: ISSUE_RED }} className="shrink-0 mt-0.5" />}
            <div>
              <div className="font-semibold text-sm" style={{ color: report.clientResponse.decision === "confirmed" ? OK_GREEN : ISSUE_RED }}>
                {report.clientResponse.decision === "confirmed" ? "Condition confirmed" : "Condition disputed"} by {report.clientResponse.name}
              </div>
              {report.clientResponse.comment && (
                <div className="text-sm mt-1" style={{ color: INK }}>{report.clientResponse.comment}</div>
              )}
              <div className="text-xs mt-1" style={{ color: STEEL }}>
                {new Date(report.clientResponse.date).toLocaleString()}
              </div>
              {report.clientResponse.signature && (
                <img
                  src={report.clientResponse.signature}
                  alt="Signature"
                  className="mt-3 rounded-lg border bg-white"
                  style={{ borderColor: LINE, maxWidth: 240, height: "auto" }}
                />
              )}
            </div>
          </div>
        ) : null}

        {alreadyResponded && (
          <button
            onClick={() => window.print()}
            className="w-full mt-4 rounded-xl py-3.5 font-semibold border-2 flex items-center justify-center gap-2 print:hidden"
            style={{ borderColor: NAVY, color: NAVY }}
          >
            <Download size={18} /> Download as PDF
          </button>
        )}

        {!alreadyResponded && (
          <Section title="Your Sign-off">
            <div className="text-sm mb-3" style={{ color: INK }}>
              Please review the condition recorded above. By confirming, you agree this is an accurate record and that ATD is not responsible for anything not noted here.
            </div>
            <div className="grid grid-cols-2 gap-2 mb-3">
              <button
                onClick={() => setDecision("confirmed")}
                className="rounded-lg py-3 text-sm font-semibold border-2 flex items-center justify-center gap-1.5"
                style={{
                  borderColor: decision === "confirmed" ? OK_GREEN : LINE,
                  background: decision === "confirmed" ? "#E3F1E7" : "white",
                  color: decision === "confirmed" ? OK_GREEN : INK,
                }}
              >
                <Check size={16} /> Confirm
              </button>
              <button
                onClick={() => setDecision("disputed")}
                className="rounded-lg py-3 text-sm font-semibold border-2 flex items-center justify-center gap-1.5"
                style={{
                  borderColor: decision === "disputed" ? ISSUE_RED : LINE,
                  background: decision === "disputed" ? "#FBE7E5" : "white",
                  color: decision === "disputed" ? ISSUE_RED : INK,
                }}
              >
                <X size={16} /> Dispute
              </button>
            </div>
            <Field label="YOUR NAME">
              <TextInput value={name} onChange={setName} placeholder="Type your full name to sign" />
            </Field>
            <Field label="COMMENT (OPTIONAL)">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                className={inputCls}
                style={inputStyle}
                placeholder={decision === "disputed" ? "Tell us what looks wrong" : "Anything you'd like to add"}
              />
            </Field>
            <Field label="SIGNATURE">
              <SignaturePad onChange={setSignature} />
            </Field>
            <button
              onClick={submit}
              disabled={!name.trim() || !decision || !signature || saving}
              className="w-full rounded-xl py-3.5 font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-40"
              style={{ background: NAVY }}
            >
              {saving ? <Loader2 size={18} className="animate-spin" /> : null}
              Submit sign-off
            </button>
          </Section>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="bg-white rounded-lg border p-2.5 print:break-inside-avoid" style={{ borderColor: LINE }}>
      <div className="text-[10px] font-semibold" style={{ color: STEEL }}>{label.toUpperCase()}</div>
      <div className="text-sm font-medium" style={{ color: INK }}>{value || "—"}</div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Root app
----------------------------------------------------------------*/
export default function App() {
  // loading | login | dashboard | edit | diagram | interiorDiagram | share | clientAccess | clientView | vehicleView
  const [view, setView] = useState("loading");
  const [authed, setAuthed] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [index, setIndex] = useState([]);
  const [report, setReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [clientReport, setClientReport] = useState(null);
  const [clientAccessError, setClientAccessError] = useState("");
  const [vehicleDocs, setVehicleDocs] = useState(null);
  const [clientViewOrigin, setClientViewOrigin] = useState("clientAccess");
  const [openingDocId, setOpeningDocId] = useState(null);

  useEffect(() => {
    (async () => {
      // A real client link: /sign/<code>. No staff login involved — the
      // code itself is the access capability, same as the original design.
      const signMatch = window.location.pathname.match(/^\/sign\/([A-Za-z0-9]{3,10})$/);
      if (signMatch) {
        try {
          const r = await api.fetchReport(signMatch[1].toUpperCase());
          setClientReport(normalizeReport(r));
          setClientViewOrigin("clientAccess");
          setView("clientView");
        } catch (e) {
          setClientAccessError("That report link doesn't look right. Enter your code below.");
          setView("clientAccess");
        }
        return;
      }

      // A vehicle's own link: /vehicle/<code> — shows every report sent for
      // that car, same public-by-code design as /sign/<code>.
      const vehicleMatch = window.location.pathname.match(/^\/vehicle\/([A-Za-z0-9]{3,10})$/);
      if (vehicleMatch) {
        try {
          const v = await api.fetchVehicleDocuments(vehicleMatch[1].toUpperCase());
          setVehicleDocs(v);
          setView("vehicleView");
        } catch (e) {
          setClientAccessError("That vehicle link doesn't look right. Enter your code below.");
          setView("clientAccess");
        }
        return;
      }

      if (api.getToken()) {
        try {
          const idx = await api.fetchIndex();
          setIndex(idx);
          setAuthed(true);
          setIsAdmin(api.getRole() === "admin");
          setView("dashboard");
          return;
        } catch (e) {
          // token expired/invalid — fall through to login
        }
      }
      setView("login");
    })();
  }, []);

  const refreshIndex = useCallback(async () => {
    try {
      setIndex(await api.fetchIndex());
    } catch (e) {}
  }, []);

  const startNew = () => {
    setReport(blankReport());
    setView("edit");
  };

  const openExisting = async (id) => {
    try {
      const r = await api.fetchReport(id);
      setReport(normalizeReport(r));
      setView("edit");
    } catch (e) {}
  };

  const submitReport = async () => {
    setSaving(true);
    try {
      const submitted = { ...report, status: "awaiting_signoff" };
      const saved = await api.saveReportApi(submitted);
      setReport(saved);
      await refreshIndex();
      setView("share");
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const openVehicleDocument = async (id) => {
    setOpeningDocId(id);
    try {
      const r = await api.fetchReport(id);
      setClientReport(normalizeReport(r));
      setClientViewOrigin("vehicleView");
      setView("clientView");
    } catch (e) {
    } finally {
      setOpeningDocId(null);
    }
  };

  const logout = () => {
    api.logout();
    setAuthed(false);
    setIsAdmin(false);
    setIndex([]);
    setView("login");
  };

  const deleteReport = async (id) => {
    await api.deleteReport(id);
    await refreshIndex();
  };

  if (view === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: PAPER }}>
        <Loader2 size={26} className="animate-spin" style={{ color: NAVY }} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: PAPER, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div className="max-w-md print:max-w-none mx-auto min-h-screen bg-white shadow-sm print:shadow-none" style={{ background: PAPER }}>
        {view === "login" && (
          <LoginScreen
            onLoggedIn={(idx, role) => { setIndex(idx); setAuthed(true); setIsAdmin(role === "admin"); setView("dashboard"); }}
            onViewByCode={() => { setClientAccessError(""); setView("clientAccess"); }}
          />
        )}

        {view === "dashboard" && authed && (
          <Dashboard
            index={index}
            onNew={startNew}
            onOpen={openExisting}
            onClientAccess={() => setView("clientAccess")}
            onLogout={logout}
            isAdmin={isAdmin}
            onDelete={deleteReport}
          />
        )}

        {view === "edit" && authed && report && (
          <InspectionEditor
            report={report}
            setReport={setReport}
            onBack={() => setView("dashboard")}
            onOpenDiagram={() => setView("diagram")}
            onOpenInteriorDiagram={() => setView("interiorDiagram")}
            onSubmit={submitReport}
            saving={saving}
          />
        )}

        {view === "diagram" && authed && report && (
          <DiagramScreen
            report={report}
            setReport={setReport}
            onBack={() => setView("edit")}
          />
        )}

        {view === "interiorDiagram" && authed && report && (
          <InteriorDiagramScreen
            report={report}
            setReport={setReport}
            onBack={() => setView("edit")}
          />
        )}

        {view === "share" && authed && report && (
          <ShareScreen
            report={report}
            onBack={() => setView("dashboard")}
            onDone={() => setView("dashboard")}
          />
        )}

        {view === "clientAccess" && (
          <ClientAccessScreen
            onBack={() => setView(authed ? "dashboard" : "login")}
            onFound={(r) => { setClientReport(normalizeReport(r)); setClientViewOrigin("clientAccess"); setView("clientView"); }}
            onFoundVehicle={(v) => { setVehicleDocs(v); setView("vehicleView"); }}
            initialError={clientAccessError}
          />
        )}

        {view === "vehicleView" && vehicleDocs && (
          <VehicleDocumentsScreen
            vehicle={vehicleDocs.vehicle}
            documents={vehicleDocs.documents}
            onBack={() => setView("clientAccess")}
            onOpenDocument={openVehicleDocument}
            loadingId={openingDocId}
          />
        )}

        {view === "clientView" && clientReport && (
          <ClientViewScreen
            report={clientReport}
            onBack={() => setView(clientViewOrigin)}
            onRespond={async (resp) => {
              const updated = await api.respondToReport(clientReport.id, resp);
              setClientReport(normalizeReport(updated));
            }}
          />
        )}
      </div>
    </div>
  );
}
