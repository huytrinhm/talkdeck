import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";
export function pairingQrUrl(value?: string) {
  try {
    if (!value || value.length > 2048) return undefined;
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
/** Encodes only the service-issued URL locally. No external QR image service or automatic login. */
export function PairingQr({ url }: { url?: string }) {
  const safe = pairingQrUrl(url),
    [matrix, setMatrix] = useState<{
      url: string;
      size: number;
      path: string;
    } | null>(null),
    [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setError(false);
    if (safe)
      void import("qrcode")
        .then(({ default: QR }) => {
          const qr = QR.create(safe, { errorCorrectionLevel: "M" });
          let path = "";
          for (let y = 0; y < qr.modules.size; y++)
            for (let x = 0; x < qr.modules.size; x++)
              if (qr.modules.get(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;
          if (!cancelled)
            setMatrix({ url: safe, size: qr.modules.size + 8, path });
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    return () => {
      cancelled = true;
    };
  }, [safe]);
  return (
    <div className="pairing-qr">
      {safe && matrix?.url === safe ? (
        <svg
          role="img"
          aria-label="Phone pairing QR code"
          viewBox={`0 0 ${matrix.size} ${matrix.size}`}
          shapeRendering="crispEdges"
        >
          <rect width="100%" height="100%" fill="#fff" />
          <path d={matrix.path} fill="#111" />
        </svg>
      ) : (
        <div className="pairing-qr-placeholder">
          <QrCode aria-hidden="true" />
          <strong>
            {safe && !error
              ? "Preparing pairing QR…"
              : "Pairing QR unavailable"}
          </strong>
        </div>
      )}
    </div>
  );
}
