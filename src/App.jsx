import React, { useState, useEffect, useRef, useCallback } from "react";
import * as api from "./api.js";
import {
  Camera, MapPin, Check, X, ChevronLeft, Plus, Link2, Trash2,
  Car, ClipboardList, Send, ShieldCheck, AlertTriangle, Loader2,
  ChevronRight, Copy, CheckCircle2, XCircle, Clock, FileText
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
const OKISSUE = ["OK", "Issue"];
const CHECKLIST_ITEMS = [
  "Wheels & tyres — condition / flat-spotting",
  "Battery voltage / conditioner status",
  "Alarm / immobiliser functioning",
  "Fluid leaks / drip tray check",
];

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
    make: "",
    reg: "",
    bay: "",
    battery: "",
    ownConditioner: "",
    coverFitted: "",
    handbrake: "",
    fuel: "",
    checklist: {},
    pins: [],
    clientResponse: null,
  };
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
    <div
      className="flex items-center justify-between px-4 py-3 sticky top-0 z-20"
      style={{ background: NAVY, color: "white" }}
    >
      <div className="flex items-center gap-2 min-w-0">
        {onBack && (
          <button onClick={onBack} className="p-1 -ml-1 rounded active:bg-white/10">
            <ChevronLeft size={22} />
          </button>
        )}
        <div className="min-w-0">
          <div className="text-[10px] tracking-[0.2em] uppercase" style={{ color: GOLD }}>ATD Automotive Storage</div>
          <div className="font-semibold text-base truncate">{title}</div>
        </div>
      </div>
      {right}
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
   Car diagram — front / roof / rear / both sides, tap to drop a pin
----------------------------------------------------------------*/
const CANVAS_W = 640;
const CANVAS_H = 812;

const PANELS = {
  front: { x: 65, y: 20, w: 170, h: 228, vbW: 380, vbH: 260 },
  roof: { x: 255, y: 20, w: 130, h: 228, vbW: 320, vbH: 561 },
  rear: { x: 405, y: 20, w: 170, h: 228, vbW: 380, vbH: 260 },
  left: { x: 20, y: 268, w: 600, h: 252, vbW: 620, vbH: 260 },
  right: { x: 20, y: 540, w: 600, h: 252, vbW: 620, vbH: 260 },
};

function panelArtBox(p) {
  const scale = p.w / p.vbW;
  const artH = p.vbH * scale;
  const offsetY = (p.h - artH) / 2;
  return { scale, offsetY };
}

function FrontArt() {
  return (
    <>
      <line x1="10" y1="222" x2="370" y2="222" stroke="#0B2545" strokeWidth="1.6" strokeDasharray="4,4" />
      <path d="M70,208 L64,160 C60,120 74,80 102,58 C118,44 130,36 150,32 C165,29 215,29 230,32 C250,36 262,44 278,58 C306,80 320,120 316,160 L310,208 C310,216 302,222 292,222 L88,222 C78,222 70,216 70,208 Z" fill="#ffffff" stroke="#0B2545" strokeWidth="3" strokeLinejoin="round" />
      <path d="M150,32 C155,26 225,26 230,32" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M108,64 L272,64 L250,106 L130,106 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M78,140 C78,126 90,116 106,116 C122,116 132,128 130,144 C128,158 114,166 98,164 C84,162 78,152 78,140 Z" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M302,140 C302,126 290,116 274,116 C258,116 248,128 250,144 C252,158 266,166 282,164 C296,162 302,152 302,140 Z" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="140" y="122" width="100" height="52" rx="8" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="140" y1="138" x2="240" y2="138" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="140" y1="154" x2="240" y2="154" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="190" cy="148" r="8" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="150" y="188" width="80" height="20" rx="6" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M75,182 L305,182" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M72,196 L308,196" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="100" cy="196" r="8" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="280" cy="196" r="8" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M46,206 L70,206 L70,222 L54,222 C46,222 42,216 44,206 Z" fill="#cfd4db" stroke="#0B2545" strokeWidth="2" />
      <path d="M334,206 L310,206 L310,222 L326,222 C334,222 338,216 336,206 Z" fill="#cfd4db" stroke="#0B2545" strokeWidth="2" />
      <text x="190" y="245" fontSize="17" fill="#0B2545" textAnchor="middle" fontWeight="600">FRONT</text>
    </>
  );
}

function RearArt() {
  return (
    <>
      <line x1="10" y1="222" x2="370" y2="222" stroke="#0B2545" strokeWidth="1.6" strokeDasharray="4,4" />
      <path d="M70,208 L64,160 C60,120 74,80 102,58 C118,44 130,36 150,32 C165,29 215,29 230,32 C250,36 262,44 278,58 C306,80 320,120 316,160 L310,208 C310,216 302,222 292,222 L88,222 C78,222 70,216 70,208 Z" fill="#ffffff" stroke="#0B2545" strokeWidth="3" strokeLinejoin="round" />
      <path d="M150,32 C155,26 225,26 230,32" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M116,64 L264,64 L246,104 L134,104 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M66,120 C64,112 70,104 82,102 L100,102 C110,104 114,114 112,128 L108,158 C106,168 96,172 84,168 C74,164 68,144 66,120 Z" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M314,120 C316,112 310,104 298,102 L280,102 C270,104 266,114 268,128 L272,158 C274,168 284,172 296,168 C306,164 312,144 314,120 Z" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="128" y="112" width="124" height="66" rx="8" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="190" y1="112" x2="190" y2="178" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="190" cy="140" r="7" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M75,186 L305,186" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M72,200 L308,200" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="150" y="188" width="80" height="18" rx="2" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="100" cy="196" r="7" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="280" cy="196" r="7" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="86" y="206" width="24" height="10" rx="3" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="270" y="206" width="24" height="10" rx="3" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M46,206 L70,206 L70,222 L54,222 C46,222 42,216 44,206 Z" fill="#cfd4db" stroke="#0B2545" strokeWidth="2" />
      <path d="M334,206 L310,206 L310,222 L326,222 C334,222 338,216 336,206 Z" fill="#cfd4db" stroke="#0B2545" strokeWidth="2" />
      <text x="190" y="245" fontSize="17" fill="#0B2545" textAnchor="middle" fontWeight="600">REAR</text>
    </>
  );
}

function RoofArt() {
  return (
    <>
      <path d="M160,14 C185,14 202,20 210,34 C218,48 222,66 222,86 L222,118 C238,120 250,128 253,142 L256,178 C257,188 257,198 253,206 C249,213 240,216 228,217 L228,343 C240,344 249,347 253,354 C257,362 257,372 256,382 L253,418 C250,432 238,440 222,442 L222,474 C222,494 218,512 210,526 C202,540 185,546 160,546 C135,546 118,540 110,526 C102,512 98,494 98,474 L98,442 C82,440 70,432 67,418 L64,382 C63,372 63,362 67,354 C71,347 80,344 92,343 L92,217 C80,216 71,213 67,206 C63,198 63,188 64,178 L67,142 C70,128 82,120 98,118 L98,86 C98,66 102,48 110,34 C118,20 135,14 160,14 Z" fill="#ffffff" stroke="#0B2545" strokeWidth="3" strokeLinejoin="round" />
      <path d="M120,110 L200,110 L192,148 L128,148 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M124,410 L196,410 L188,374 L132,374 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="120" y="148" width="80" height="226" rx="14" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="160" y1="150" x2="160" y2="372" stroke="#0B2545" strokeWidth="1.6" strokeDasharray="3,5" />
      <line x1="160" y1="24" x2="160" y2="104" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="160" y1="416" x2="160" y2="536" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M118,20 C130,16 190,16 202,20" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M118,540 C130,544 190,544 202,540" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="98" y1="248" x2="222" y2="248" stroke="#0B2545" strokeWidth="1.6" strokeDasharray="4,4" />
      <line x1="98" y1="312" x2="222" y2="312" stroke="#0B2545" strokeWidth="1.6" strokeDasharray="4,4" />
      <path d="M96,140 L78,130 L82,158 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M224,140 L242,130 L238,158 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <rect x="76" y="150" width="18" height="58" rx="5" fill="#333333" stroke="#0B2545" strokeWidth="1" />
      <rect x="226" y="150" width="18" height="58" rx="5" fill="#333333" stroke="#0B2545" strokeWidth="1" />
      <rect x="76" y="352" width="18" height="58" rx="5" fill="#333333" stroke="#0B2545" strokeWidth="1" />
      <rect x="226" y="352" width="18" height="58" rx="5" fill="#333333" stroke="#0B2545" strokeWidth="1" />
      <text x="160" y="46" fontSize="15" fill="#0B2545" textAnchor="middle" fontWeight="600">FRONT</text>
      <text x="160" y="524" fontSize="15" fill="#0B2545" textAnchor="middle" fontWeight="600">REAR</text>
    </>
  );
}

function SideArt({ mirrored, label }) {
  return (
    <g transform={mirrored ? "translate(620,0) scale(-1,1)" : undefined}>
      <line x1="10" y1="216" x2="610" y2="216" stroke="#0B2545" strokeWidth="1.6" strokeDasharray="4,4" />
      <path d="M48,188 C44,178 48,170 58,167 L88,163 C97,134 120,109 150,97 C170,89 182,80 192,66 C206,48 227,38 253,37 L358,37 C390,39 416,54 432,80 C442,96 449,112 453,129 L488,150 C498,154 505,161 507,170 L556,174 C570,176 579,184 581,195 C582,200 578,204 570,204 L548,204 L548,178 L86,178 L86,204 L64,204 C54,204 48,198 48,188 Z" fill="#ffffff" stroke="#0B2545" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M150,97 C168,90 180,82 192,68 L212,68 L198,158 L158,158 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="192" y1="68" x2="200" y2="158" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M212,68 L358,68" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M358,68 L378,68 C398,72 414,86 424,106 L410,158 L364,158 Z" fill="#eef1f5" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="424" y1="106" x2="410" y2="158" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="286" y1="70" x2="284" y2="204" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="228" y1="140" x2="252" y2="140" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="328" y1="140" x2="352" y2="140" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="218" y1="158" x2="218" y2="118" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="356" y1="158" x2="356" y2="118" stroke="#0B2545" strokeWidth="1.6" />
      <line x1="86" y1="178" x2="548" y2="178" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M58,167 L58,178" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <path d="M556,174 L556,178" fill="none" stroke="#0B2545" strokeWidth="1.6" />
      <circle cx="152" cy="192" r="34" fill="#333333" stroke="#0B2545" strokeWidth="2" />
      <circle cx="152" cy="192" r="16" fill="#cfd4db" stroke="#0B2545" strokeWidth="1.4" />
      <circle cx="492" cy="192" r="34" fill="#333333" stroke="#0B2545" strokeWidth="2" />
      <circle cx="492" cy="192" r="16" fill="#cfd4db" stroke="#0B2545" strokeWidth="1.4" />
      <text x="310" y="240" fontSize="17" fill="#0B2545" textAnchor="middle" fontWeight="600" transform={mirrored ? "translate(620,0) scale(-1,1)" : undefined}>{label}</text>
    </g>
  );
}

function panelLabel(key) {
  return { front: "Front", rear: "Rear", roof: "Roof", left: "Left / Driver Side", right: "Right / Passenger Side" }[key];
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
        {Object.entries(PANELS).map(([key, p]) => {
          const { scale, offsetY } = panelArtBox(p);
          const Art = key === "front" ? FrontArt : key === "rear" ? RearArt : key === "roof" ? RoofArt : null;
          if (Art) {
            return (
              <g key={key} transform={`translate(${p.x},${p.y + offsetY}) scale(${scale})`}>
                <Art />
              </g>
            );
          }
          return (
            <g key={key} transform={`translate(${p.x},${p.y + offsetY}) scale(${scale})`}>
              <SideArt mirrored={key === "right"} label={key === "left" ? "LEFT / DRIVER SIDE" : "RIGHT / PASSENGER SIDE"} />
            </g>
          );
        })}

        {/* section dividers */}
        <line x1="0" y1="258" x2={CANVAS_W} y2="258" stroke={LINE} strokeWidth="2" />
        <line x1="0" y1="530" x2={CANVAS_W} y2="530" stroke={LINE} strokeWidth="2" />

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
          Tap any panel — front, roof, rear, or either side — to mark a point of damage
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
  const setChecklist = (item, v) =>
    setReport((r) => ({ ...r, checklist: { ...r.checklist, [item]: v } }));

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
              <TextInput value={report.reg} onChange={(v) => set("reg", v)} placeholder="e.g. GY 1234" />
            </Field>
          </div>
          <Field label="STORAGE BAY">
            <TextInput value={report.bay} onChange={(v) => set("bay", v)} placeholder="e.g. B14" />
          </Field>
        </Section>

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

        <Section title="Quick Checklist">
          {CHECKLIST_ITEMS.map((item) => (
            <div key={item} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: LINE }}>
              <div className="text-sm pr-3" style={{ color: INK }}>{item}</div>
              <div className="w-28 shrink-0">
                <Select value={report.checklist[item] || ""} onChange={(v) => setChecklist(item, v)} options={OKISSUE} placeholder="—" />
              </div>
            </div>
          ))}
        </Section>

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
   Client view — read only, confirm / dispute
----------------------------------------------------------------*/
function ClientViewScreen({ report, onBack, onRespond }) {
  const [decision, setDecision] = useState(null); // 'confirmed' | 'disputed'
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [viewPin, setViewPin] = useState(null);

  const alreadyResponded = !!report.clientResponse;

  const submit = async () => {
    if (!name.trim() || !decision) return;
    setSaving(true);
    await onRespond({ decision, name: name.trim(), comment, date: new Date().toISOString() });
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

        {alreadyResponded ? (
          <div
            className="rounded-xl p-4 flex items-start gap-3"
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
            </div>
          </div>
        ) : (
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
            <button
              onClick={submit}
              disabled={!name.trim() || !decision || saving}
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
    <div className="bg-white rounded-lg border p-2.5" style={{ borderColor: LINE }}>
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
          setClientReport(r);
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
      setReport(r);
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
      <div className="max-w-md mx-auto min-h-screen bg-white shadow-sm" style={{ background: PAPER }}>
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
            onFound={(r) => { setClientReport(r); setView("clientView"); }}
            initialError={clientAccessError}
          />
        )}

        {view === "clientView" && clientReport && (
          <ClientViewScreen
            report={clientReport}
            onBack={() => setView("clientAccess")}
            onRespond={async (resp) => {
              const updated = await api.respondToReport(clientReport.id, resp);
              setClientReport(updated);
            }}
          />
        )}
      </div>
    </div>
  );
}
