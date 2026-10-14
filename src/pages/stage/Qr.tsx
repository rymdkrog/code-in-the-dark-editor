import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** Quiet zone, in modules: the white border a scanner needs around the code. */
const QUIET = 4;

/** A QR code as crisp SVG, black on white, so it scans off a projector. */
export function Qr({ text, size }: { text: string; size: number }) {
  const { modules, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text);
    code.make();
    const modules = code.getModuleCount();
    let path = "";
    for (let row = 0; row < modules; row++) {
      for (let col = 0; col < modules; col++) if (code.isDark(row, col)) path += `M${col} ${row}h1v1h-1z`;
    }
    return { modules, path };
  }, [text]);
  const side = modules + 2 * QUIET;
  return (
    <svg
      className="qr"
      role="img"
      aria-label={`QR code for ${text}`}
      width={size}
      height={size}
      viewBox={`${-QUIET} ${-QUIET} ${side} ${side}`}
      shapeRendering="crispEdges"
    >
      <rect x={-QUIET} y={-QUIET} width={side} height={side} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
