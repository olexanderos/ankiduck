import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';

function cornerInsideRadius(x, y, size, margin) {
  if (x >= margin && x <= size - margin) return true;
  if (y >= margin && y <= size - margin) return true;
  const cx = x < margin ? margin : size - margin;
  const cy = y < margin ? margin : size - margin;
  return Math.hypot(cx - x, cy - y) < margin;
}

function generateIcon(size, outPath) {
  const png = new PNG({ width: size, height: size });
  const margin = size * 0.08;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      const inside = cornerInsideRadius(x, y, size, margin);
      if (inside) {
        png.data[idx] = 0xf5;
        png.data[idx + 1] = 0xc5;
        png.data[idx + 2] = 0x1e;
        png.data[idx + 3] = 0xff;
      } else {
        png.data[idx] = 0;
        png.data[idx + 1] = 0;
        png.data[idx + 2] = 0;
        png.data[idx + 3] = 0;
      }
    }
  }
  writeFileSync(outPath, PNG.sync.write(png));
}

mkdirSync('public/icons', { recursive: true });
generateIcon(192, 'public/icons/icon-192.png');
generateIcon(512, 'public/icons/icon-512.png');
console.log('Generated public/icons/icon-192.png and icon-512.png');
