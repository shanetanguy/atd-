import React, { useState, useEffect, useRef, useCallback } from "react";
import * as api from "./api.js";
import { CAR_ART_PATHS } from "./carArt.js";
import atdLogo from "./assets/atd-logo.png";
import {
  Camera, MapPin, Check, X, ChevronLeft, Plus, Link2, Trash2,
  Car, ClipboardList, Send, ShieldCheck, AlertTriangle, Loader2,
  ChevronRight, Copy, CheckCircle2, XCircle, Clock, FileText, Download
} from "lucide-react";

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
  { code: "C", label: "Chip", color: "#B8730C" },
  { code: "D", label: "Dent", color: "#B3261E" },
  { code: "P", label: "Paint / Colour Loss", color: "#8E4EC6" },
  { code: "CR", label: "Crack", color: "#1B6FB8" },
  { code: "M", label: "Missing Part", color: "#3A3A3A" },
];

const YN = ["Y", "N"];
const FUEL_LEVELS = ["0%", "25%", "50%", "75%", "100%"];
const CLIENT_TYPES = ["Individual", "Trustee-Held"];
const REPORT_TYPES = ["Intake", "Routine", "Release"];
const CHECKLIST_STATUS = ["OK", "Issue", "Not Checked"];
const SPARE_WHEEL_OPTIONS = ["Y", "N", "Space-Saver"];
const V5_OPTIONS = ["Y", "N", "Held by Trustee"];
const CABLE_OPTIONS = ["Y", "N", "N/A"];

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
    "Existing damage / pre-existing marks logged",
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
  return Object.fromEntries(TYRE_POSITIONS.map((p) => [p.key, { factory: "", reading: "", reset: false }]));
}

function blankItems() {
  return {
    keysCount: "",
    serviceBook: "",
    spareWheel: "",
    lockingWheelNut: "",
    ownersManual: "",
    parcelShelf: "",
    v5Doc: "",
    chargingCable: "",
    insuranceConfirmed: "",
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
    receivedFrom: "",
    handedOverBy: "",
    // Release only
    releasedTo: "",
    recipientName: "",
    idChecked: "",
    transportCo: "",
    driverName: "",
    collectionRef: "",
    items: blankItems(),
    tyres: blankTyres(),
    checklist: {},
    pins: [],
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
    tyres: { ...blankTyres(), ...(r.tyres || {}) },
    checklist: r.checklist || {},
    pins: r.pins || [],
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
    <div className="sticky print:static top-0 z-20" style={{ background: NAVY, color: "white" }}>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2 px-2 pt-3">
        <div className="flex items-center min-w-[28px]">
          {onBack && (
            <button onClick={onBack} className="p-1 rounded active:bg-white/10 print:hidden">
              <ChevronLeft size={22} />
            </button>
          )}
        </div>
        <div className="flex justify-center">
          <img src={atdLogo} alt="ATD Automotive Storage" className="h-10 w-auto print:h-12" />
        </div>
        <div className="flex items-center justify-end min-w-[28px]">{right}</div>
      </div>
      <div className="px-4 pb-3 pt-1.5 text-center font-semibold text-base truncate">{title}</div>
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

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
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
          const dc = DAMAGE_CODES.find((d) => d.code === pin.code) || DAMAGE_CODES[0];
          const isActive = activePinId === pin.id;
          return (
            <g
              key={pin.id}
              transform={`translate(${cx}, ${cy})`}
              onClick={(e) => { e.stopPropagation(); onSelectPin && onSelectPin(pin.id); }}
              style={{ cursor: "pointer" }}
            >
              <circle r={isActive ? 14 : 11} fill={dc.color} stroke="white" strokeWidth="2.5" />
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
   Pin editor sheet
----------------------------------------------------------------*/
function PinSheet({ pin, onSave, onDelete, onClose }) {
  const [code, setCode] = useState(pin.code || "S");
  const [note, setNote] = useState(pin.note || "");
  const [photo, setPhoto] = useState(pin.photo || null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await resizeImage(file);
      setPhoto(dataUrl);
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
            {busy ? "Processing…" : "Take or add a photo"}
          </button>
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
            onClick={() => onSave({ ...pin, code, note, photo })}
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
      await api.login(password);
      const idx = await api.fetchIndex();
      onLoggedIn(idx);
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
   Dashboard
----------------------------------------------------------------*/
function Dashboard({ index, onNew, onOpen, onClientAccess, onLogout }) {
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

        {index.length === 0 && (
          <div className="text-center py-16 rounded-xl border" style={{ borderColor: LINE, color: STEEL }}>
            <ClipboardList size={28} className="mx-auto mb-2 opacity-50" />
            <div className="text-sm">No inspections yet.</div>
            <div className="text-xs mt-1">Start a new inspection to get going.</div>
          </div>
        )}

        <div className="space-y-2">
          {index.slice().reverse().map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="w-full text-left bg-white rounded-xl p-3.5 border flex items-center justify-between"
              style={{ borderColor: LINE }}
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
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Inspection editor
----------------------------------------------------------------*/
function InspectionEditor({ report, setReport, onBack, onOpenDiagram, onSubmit, saving }) {
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
  const checklistItems = CHECKLIST_ITEMS[report.reportType] || CHECKLIST_ITEMS.Routine;

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
            <Field label="REGISTRATION / VIN">
              <TextInput value={report.reg} onChange={(v) => set("reg", v)} placeholder="e.g. GY 1234" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="COLOUR">
              <TextInput value={report.colour} onChange={(v) => set("colour", v)} placeholder="e.g. Guards Red" />
            </Field>
            <Field label="YEAR">
              <TextInput value={report.year} onChange={(v) => set("year", v)} placeholder="e.g. 2022" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ODOMETER">
              <TextInput value={report.odometer} onChange={(v) => set("odometer", v)} placeholder="e.g. 12,400 mi" />
            </Field>
            <Field label="STORAGE BAY">
              <TextInput value={report.bay} onChange={(v) => set("bay", v)} placeholder="e.g. B14" />
            </Field>
          </div>
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
            <Field label="BATTERY CONDITIONER"><Select value={report.battery} onChange={(v) => set("battery", v)} options={YN} /></Field>
            <Field label="OWN CONDITIONER SUPPLIED"><Select value={report.ownConditioner} onChange={(v) => set("ownConditioner", v)} options={YN} /></Field>
            <Field label="COVER FITTED"><Select value={report.coverFitted} onChange={(v) => set("coverFitted", v)} options={YN} /></Field>
            <Field label="HANDBRAKE OFF"><Select value={report.handbrake} onChange={(v) => set("handbrake", v)} options={YN} /></Field>
          </div>
          <Field label="FUEL / CHARGE LEVEL">
            <Select value={report.fuel} onChange={(v) => set("fuel", v)} options={FUEL_LEVELS} />
          </Field>
        </Section>

        {(isIntake || isRelease) && (
          <Section title={isIntake ? "Documents & Items Received" : "Documents & Items Returned"}>
            <div className="grid grid-cols-2 gap-3">
              <Field label={isIntake ? "KEYS / FOBS RECEIVED" : "KEYS / FOBS RETURNED"}>
                <TextInput value={report.items.keysCount} onChange={(v) => setItem("keysCount", v)} placeholder="No." />
              </Field>
              <Field label={isIntake ? "SERVICE BOOK RECEIVED" : "SERVICE BOOK RETURNED"}>
                <Select value={report.items.serviceBook} onChange={(v) => setItem("serviceBook", v)} options={YN} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SPARE WHEEL PRESENT"><Select value={report.items.spareWheel} onChange={(v) => setItem("spareWheel", v)} options={SPARE_WHEEL_OPTIONS} /></Field>
              <Field label="LOCKING WHEEL NUT KEY"><Select value={report.items.lockingWheelNut} onChange={(v) => setItem("lockingWheelNut", v)} options={YN} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="OWNER'S MANUAL PRESENT"><Select value={report.items.ownersManual} onChange={(v) => setItem("ownersManual", v)} options={YN} /></Field>
              <Field label="PARCEL SHELF / BOOT COVER"><Select value={report.items.parcelShelf} onChange={(v) => setItem("parcelShelf", v)} options={YN} /></Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="V5 / REGISTRATION DOC"><Select value={report.items.v5Doc} onChange={(v) => setItem("v5Doc", v)} options={V5_OPTIONS} /></Field>
              <Field label="CHARGING CABLE (EV/HYBRID)"><Select value={report.items.chargingCable} onChange={(v) => setItem("chargingCable", v)} options={CABLE_OPTIONS} /></Field>
            </div>
            {isIntake ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="INSURANCE CONFIRMED"><Select value={report.items.insuranceConfirmed} onChange={(v) => setItem("insuranceConfirmed", v)} options={YN} /></Field>
                <Field label="MOT / INSPECTION VALID TO">
                  <TextInput value={report.items.motValidTo} onChange={(v) => setItem("motValidTo", v)} placeholder="YYYY-MM-DD" />
                </Field>
              </div>
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
        </Section>

        {isRelease && (
          <div className="rounded-lg p-3 mb-5 text-xs" style={{ background: `${GOLD}15`, color: STEEL }}>
            By signing below, the recipient confirms they have inspected the vehicle and agree it is being released in the condition recorded on this report. ATD Automotive Detailing accepts no responsibility for any damage, fault, or missing item not noted above at the time of release.
          </div>
        )}

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
                const dc = DAMAGE_CODES.find((d) => d.code === p.code) || DAMAGE_CODES[0];
                return (
                  <button
                    key={p.id}
                    onClick={() => setActivePinId(p.id)}
                    className="w-full flex items-center gap-3 bg-white rounded-lg p-2.5 border text-left"
                    style={{ borderColor: LINE }}
                  >
                    <span
                      className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                      style={{ background: dc.color }}
                    >
                      {p.code}{p.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate" style={{ color: INK }}>{dc.label} · {panelLabel(p.panel)}</div>
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
  const link = `${window.location.origin}/sign/${report.id}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
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
function ClientAccessScreen({ onBack, onFound, initialError = "" }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  const lookup = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      const r = await api.fetchReport(code.trim().toUpperCase());
      onFound(r);
    } catch (e) {
      setError("No report found for that code. Check with the sender and try again.");
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
          <div className="font-semibold text-lg" style={{ color: NAVY }}>Enter your report code</div>
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
          View report
        </button>
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

        <Section title="Damage Diagram">
          <CarDiagram pins={report.pins} readOnly activePinId={viewPin} onSelectPin={setViewPin} />
          <div className="mt-3 space-y-2">
            {report.pins.map((p) => {
              const dc = DAMAGE_CODES.find((d) => d.code === p.code) || DAMAGE_CODES[0];
              return (
                <div key={p.id} className="bg-white rounded-lg p-2.5 border flex gap-3" style={{ borderColor: LINE }}>
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0" style={{ background: dc.color }}>
                    {p.code}{p.number}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium" style={{ color: INK }}>{dc.label} · {panelLabel(p.panel)}</div>
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
              <SummaryRow label="V5 / registration doc" value={report.items.v5Doc} />
              <SummaryRow label="Insurance confirmed" value={report.items.insuranceConfirmed} />
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
            <div className="rounded-lg p-3 mt-3 text-xs" style={{ background: `${GOLD}15`, color: STEEL }}>
              By confirming below, you agree the vehicle is being released in the condition recorded on this report. ATD Automotive Detailing accepts no responsibility for any damage, fault, or missing item not noted above at the time of release.
            </div>
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
  // loading | login | dashboard | edit | diagram | share | clientAccess | clientView
  const [view, setView] = useState("loading");
  const [authed, setAuthed] = useState(false);
  const [index, setIndex] = useState([]);
  const [report, setReport] = useState(null);
  const [saving, setSaving] = useState(false);
  const [clientReport, setClientReport] = useState(null);
  const [clientAccessError, setClientAccessError] = useState("");

  useEffect(() => {
    (async () => {
      // A real client link: /sign/<code>. No staff login involved — the
      // code itself is the access capability, same as the original design.
      const match = window.location.pathname.match(/^\/sign\/([A-Za-z0-9]{3,10})$/);
      if (match) {
        try {
          const r = await api.fetchReport(match[1].toUpperCase());
          setClientReport(normalizeReport(r));
          setView("clientView");
        } catch (e) {
          setClientAccessError("That report link doesn't look right. Enter your code below.");
          setView("clientAccess");
        }
        return;
      }

      if (api.getToken()) {
        try {
          const idx = await api.fetchIndex();
          setIndex(idx);
          setAuthed(true);
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

  const logout = () => {
    api.logout();
    setAuthed(false);
    setIndex([]);
    setView("login");
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
            onLoggedIn={(idx) => { setIndex(idx); setAuthed(true); setView("dashboard"); }}
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
          />
        )}

        {view === "edit" && authed && report && (
          <InspectionEditor
            report={report}
            setReport={setReport}
            onBack={() => setView("dashboard")}
            onOpenDiagram={() => setView("diagram")}
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
            onFound={(r) => { setClientReport(normalizeReport(r)); setView("clientView"); }}
            initialError={clientAccessError}
          />
        )}

        {view === "clientView" && clientReport && (
          <ClientViewScreen
            report={clientReport}
            onBack={() => setView("clientAccess")}
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
