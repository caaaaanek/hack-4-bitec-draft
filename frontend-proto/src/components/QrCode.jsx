/* QR-код як SVG: малюється в браузері (qrcode-generator, MIT), без зовнішніх запитів. */
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export const qrAbs = l => (l.startsWith("/") ? location.origin + l : l);

export function QrCode({ text, className, label }) {
  // SVG будує бібліотека лише з модулів коду: тексту посилання в розмітці немає
  const svg = useMemo(() => { const q = qrcode(0, "M"); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 1, margin: 2, scalable: true }); }, [text]);
  return <div className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: svg }} />;
}
