import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Exact paths from Argus's own app/src/components/Logo.tsx. No external brand assets.
const paths = color => `<path d="M20 4.5 L35.5 34.5 H4.5 Z" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
<path d="M11 24.5 Q20 16.5 29 24.5 Q20 32.5 11 24.5 Z" stroke="${color}" stroke-width="2.1" stroke-linejoin="round"/>
<circle cx="20" cy="24.5" r="3" fill="${color}"/>`;
for (const [name, size, color, background, box] of [
  ['icon', 1024, '#16191f', '<rect x="-10" y="-10" width="60" height="60" fill="#ffffff"/>', '-10 -10 60 60'],
  ['adaptive-icon', 1024, '#16191f', '', '-10 -10 60 60'],
  ['notification-icon', 96, '#ffffff', '', '0 0 40 40'],
]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${box}" fill="none">${background}${paths(color)}</svg>`;
  writeFileSync(fileURLToPath(new URL(`../assets/${name}.png`, import.meta.url)), new Resvg(svg).render().asPng());
  if (name === 'icon') writeFileSync(fileURLToPath(new URL('../assets/icon.svg', import.meta.url)), svg);
}
