"use client";

// QR code d'un numéro : scanné avec l'appareil photo de l'iPhone, il propose « Appeler ».
// Généré dans le navigateur (aucun service externe).
import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { toE164 } from "@/lib/call-session";

export default function PhoneQr({ number, size = 180 }) {
  const svg = useMemo(() => {
    const e164 = toE164(number);
    if (!e164) return "";
    const qr = qrcode(0, "M");
    qr.addData(`tel:${e164}`);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [number]);
  if (!svg) return null;
  return (
    <div className="phone-qr" aria-label={`QR code pour appeler le ${number}`} role="img"
      style={{ width: size, height: size, background: "#fff", borderRadius: 8, padding: 4, lineHeight: 0 }}
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
