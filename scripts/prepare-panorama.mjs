import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

// Keep the supplied photographs intact; only these bounded derivatives ship to the viewer.
const directory = fileURLToPath(new URL('../public/assets/panoramas/eiffel-tower/', import.meta.url));
for (const face of ['r', 'l', 'u', 'd', 'f', 'b']) {
  for (const size of [1024, 2048]) {
    await sharp(`${directory}${face}-l3-fallback.jpg`)
      .resize(size, size, { fit: 'fill' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(`${directory}${face}-${size}.jpg`);
  }
}
console.log('Prepared six 1024px mobile faces and six 2048px desktop faces.');
