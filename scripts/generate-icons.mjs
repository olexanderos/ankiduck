import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

// The duck artwork lives in scripts/icon/duck.svg (transparent background,
// centred on 540,530 in a 130,120 820x820 viewBox). App icons place it on a
// full-bleed background; iOS and Android apply their own corner masks.
const DUCK_SVG = 'scripts/icon/duck.svg';
const duckInner = readFileSync(DUCK_SVG, 'utf8').replace(/^[\s\S]*?<svg[^>]*>|<\/svg>\s*$/g, '');

function iconSvg(duckScale) {
  const shadowY = 512 + (820 - 530) * duckScale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><radialGradient id="bg" cx=".5" cy=".4" r=".8"><stop offset="0" stop-color="#2f6fd6"/><stop offset="1" stop-color="#1b3f8f"/></radialGradient></defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <ellipse cx="512" cy="${shadowY}" rx="${350 * duckScale}" ry="${40 * duckScale}" fill="#000" opacity=".25"/>
  <g transform="translate(512 512) scale(${duckScale}) translate(-540 -530)">${duckInner}</g>
</svg>`;
}

function renderPng(svg, size, outPath) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(outPath, png);
}

mkdirSync('public/icons', { recursive: true });
const regular = iconSvg(0.86);
// Maskable icons must keep their content inside the central 80% safe zone.
const maskable = iconSvg(0.68);

renderPng(regular, 180, 'public/icons/icon-180.png');
renderPng(regular, 192, 'public/icons/icon-192.png');
renderPng(regular, 512, 'public/icons/icon-512.png');
renderPng(maskable, 512, 'public/icons/icon-maskable-512.png');
copyFileSync(DUCK_SVG, 'public/favicon.svg');
console.log('Generated app icons in public/icons and public/favicon.svg');
