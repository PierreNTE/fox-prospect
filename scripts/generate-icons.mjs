// Génère les icônes PWA (PNG) sans aucune dépendance npm :
// encodeur PNG minimal (zlib natif de Node) + rendu vectoriel du renard.
// Usage : node scripts/generate-icons.mjs
import { deflateSync } from "zlib";
import { writeFileSync, mkdirSync } from "fs";

// ---------- Encodeur PNG minimal ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtre 0 (None) par ligne
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- Rendu du renard (même géométrie que le logo SVG, viewBox 24) ----------
// Tête : M3 4 L7 9 H17 L21 4 V11 puis arc inférieur (approx. demi-ellipse r=9 centrée 12,11).
function foxOutline() {
  const pts = [[3, 4], [7, 9], [17, 9], [21, 4], [21, 11]];
  for (let a = 0; a <= 32; a++) {
    const t = (a / 32) * Math.PI; // 0 → π (droite vers gauche par le bas)
    pts.push([12 + 9 * Math.cos(t), 11 + 9 * Math.sin(t)]);
  }
  pts.push([3, 4]);
  return pts;
}
const inPolygon = (poly, x, y) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inCircle = (cx, cy, r, x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inTriangle = (a, b, c, x, y) => {
  const s = (p1, p2) => (x - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (y - p2[1]);
  const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

function renderIcon(size) {
  const FOX = [212, 87, 29], FOX_DEEP = [169, 63, 15], WHITE = [255, 255, 255];
  const rgba = Buffer.alloc(size * size * 4);
  const poly = foxOutline();
  const scale = (size * 0.66) / 24; // marge maskable (zone sûre 80 %)
  const ox = size / 2 - 12 * scale;
  const oy = size / 2 - 12.5 * scale;
  const SS = 2; // anti-crénelage par sur-échantillonnage 2×2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS - ox) / scale;
          const y = (py + (sy + 0.5) / SS - oy) / scale;
          let white = inPolygon(poly, x, y);
          if (white) {
            if (inCircle(9, 12, 1.2, x, y) || inCircle(15, 12, 1.2, x, y)) white = false;
            if (inTriangle([12, 14.6], [10.6, 17], [13.4, 17], x, y)) white = false;
          }
          if (white) cov++;
        }
      }
      cov /= SS * SS;
      // Dégradé de fond orange (haut-gauche clair → bas-droit profond)
      const g = (px / size + py / size) / 2;
      const bg = [
        FOX[0] + (FOX_DEEP[0] - FOX[0]) * g,
        FOX[1] + (FOX_DEEP[1] - FOX[1]) * g,
        FOX[2] + (FOX_DEEP[2] - FOX[2]) * g,
      ];
      const i = (py * size + px) * 4;
      rgba[i] = Math.round(bg[0] + (WHITE[0] - bg[0]) * cov);
      rgba[i + 1] = Math.round(bg[1] + (WHITE[1] - bg[1]) * cov);
      rgba[i + 2] = Math.round(bg[2] + (WHITE[2] - bg[2]) * cov);
      rgba[i + 3] = 255;
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync("public", { recursive: true });
for (const [file, size] of [
  ["public/icon-512.png", 512],
  ["public/icon-192.png", 192],
  ["public/apple-touch-icon.png", 180],
]) {
  writeFileSync(file, renderIcon(size));
  console.log("OK", file);
}
