import { useState, useEffect, useRef } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { X } from "lucide-react";

const GOLD = "#B8933F";
const ISSUE_RED = "#B3261E";

/* ---------------------------------------------------------------
   VIN barcode scanner — most VINs carry a barcode sticker (door jamb,
   under the bonnet); scanning it beats typing 17 characters by hand.
   Text OCR of the stamped VIN plate itself was considered but dropped —
   unreliable on small embossed characters, and a misread VIN silently
   mismatches this car's history, which is worse than just typing it.

   Lazy-loaded from App.jsx (React.lazy) since @zxing carries a sizeable
   decoding library that most page loads never need.
----------------------------------------------------------------*/
export default function VinScannerModal({ onDetected, onClose }) {
  const videoRef = useRef(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let stopped = false;
    let controls = null;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current, (result) => {
        if (stopped || !result) return;
        const text = result.getText().trim();
        if (!text) return;
        stopped = true;
        controls?.stop();
        onDetected(text);
      })
      .then((c) => {
        controls = c;
        if (stopped) c.stop(); // closed before the camera finished opening
      })
      .catch(() => {
        setError("Couldn't access the camera. Check camera permissions and try again, or type the VIN in manually.");
      });

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [onDetected]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "black" }}>
      <div className="flex items-center justify-between p-4">
        <div className="text-white font-semibold">Scan VIN barcode</div>
        <button onClick={onClose} className="text-white p-1 rounded active:bg-white/10"><X size={22} /></button>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
        {!error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-8">
            <div className="w-full rounded-lg border-2" style={{ borderColor: GOLD, height: 110 }} />
          </div>
        )}
      </div>
      <div className="p-5 text-center text-sm" style={{ color: error ? ISSUE_RED : "white" }}>
        {error || "Point the camera at the VIN barcode sticker — often on the door jamb or under the bonnet."}
      </div>
    </div>
  );
}
