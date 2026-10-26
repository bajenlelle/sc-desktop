"use client";

import QRCode from "react-qr-code";

/** The link to this very page, for a phone to scan from a computer's screen. */
export function StoreQr({ url }: { url: string }) {
  return (
    <div className="mx-auto mb-6 w-fit rounded-xl bg-white p-3">
      <QRCode value={url} size={160} aria-label="QR code for the app download link" />
    </div>
  );
}
