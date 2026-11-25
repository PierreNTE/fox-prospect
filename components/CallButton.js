"use client";

// Bouton d'appel.
// - Sur téléphone (écran tactile) : lien tel: direct, l'iPhone compose le numéro.
// - Sur ordinateur : ouvre un QR code à scanner avec l'appareil photo de l'iPhone
//   (« Appeler » s'affiche), plus un bouton pour copier le numéro.
import { useEffect, useState } from "react";
import {
  Button, Dialog, DialogSurface, DialogBody, DialogTitle, DialogContent, DialogActions, Caption1, Title3,
} from "@fluentui/react-components";
import { Phone24Regular, Copy24Regular } from "@fluentui/react-icons";
import PhoneQr from "@/components/PhoneQr";
import { telHref } from "@/lib/call-session";

export function useIsPhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    try {
      const mq = window.matchMedia("(pointer: coarse)");
      setPhone(mq.matches);
      const on = (e) => setPhone(e.matches);
      mq.addEventListener?.("change", on);
      return () => mq.removeEventListener?.("change", on);
    } catch { /* navigateur ancien : on reste en mode ordinateur */ }
  }, []);
  return phone;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

export default function CallButton({ number, label, who, appearance = "primary", size = "small", title, onCall }) {
  const isPhone = useIsPhone();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!number) return null;
  const text = label || number;

  if (isPhone) {
    return (
      <Button as="a" size={size} appearance={appearance} icon={<Phone24Regular />} href={telHref(number)} title={title}
        onClick={() => onCall?.()}>
        {text}
      </Button>
    );
  }
  return (
    <>
      <Button size={size} appearance={appearance} icon={<Phone24Regular />} title={title || "Afficher le QR code pour appeler avec l'iPhone"}
        onClick={() => { setOpen(true); setCopied(false); onCall?.(); }}>
        {text}
      </Button>
      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
        <DialogSurface style={{ maxWidth: 360 }}>
          <DialogBody>
            <DialogTitle>{who || "Appeler"}</DialogTitle>
            <DialogContent style={{ display: "grid", justifyItems: "center", gap: 10 }}>
              <PhoneQr number={number} size={220} />
              <Title3>{number}</Title3>
              <Caption1 style={{ textAlign: "center" }}>
                Scanne avec l&apos;appareil photo de ton iPhone, puis touche « Appeler ».
              </Caption1>
            </DialogContent>
            <DialogActions>
              <Button icon={<Copy24Regular />} onClick={async () => setCopied(await copyText(number))}>
                {copied ? "Copié" : "Copier le numéro"}
              </Button>
              <Button appearance="primary" onClick={() => setOpen(false)}>Fermer</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </>
  );
}
