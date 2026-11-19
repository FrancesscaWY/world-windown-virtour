import { mapCalibration } from '../data/map-calibration.js';

// Envelope of the existing illustration, not geographic data or invented paths.
const parkEnvelope = [[9,8],[21,14],[25,13],[25,19],[45,29],[65,34],[91,46],[85,64],[79,80],[78,90],[71,92],[62,81],[53,80],[48,74],[37,75],[30,60],[20,58],[14,49],[12,36],[7,32],[6,19]];
const artwork = mapCalibration.artwork;

export function mapOffset(point, width, height, angle = 0, { tiltY = 1, shear = 0 } = {}) {
  const radians = angle * Math.PI / 180, x = (point.x / 100 - .5) * width, y = (point.y / 100 - .5) * height;
  const rx = x * Math.cos(radians) - y * Math.sin(radians), ry = x * Math.sin(radians) + y * Math.cos(radians);
  return { x:rx + shear * ry, y:ry * tiltY };
}

/** One affine oblique plane for artwork, roads and geographic anchors; labels invert it. */
export function mapPlane({ angle = 0, tiltY = 1, shear = 0 }) {
  const r = angle * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
  const a = co + shear * si, b = tiltY * si, c = -si + shear * co, d = tiltY * co;
  const det = a * d - b * c;
  return { transform:`matrix(${a},${b},${c},${d},0,0)`, upright:`matrix(${d/det},${-b/det},${-c/det},${a/det},0,0)` };
}

/** Flat, stable registration. Viewport height must never act as a camera rotation. */
export function mapLayout(width, height) {
  // One fixed registration, including short split panes: resize is never a rotation.
  const angle = 14;
  const points = parkEnvelope.map(([x,y]) => mapOffset({ x,y }, artwork.width, artwork.height,angle));
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const scale = Math.max(.01, Math.min((width - 8) / (right - left), (height - 16) / (bottom - top)));
  return { width:artwork.width * scale, height:artwork.height * scale, angle,
    centerX:-(left + right) / 2 * scale, centerY:-(top + bottom) / 2 * scale,
    boundsWidth:(right - left) * scale, boundsHeight:(bottom - top) * scale };
}
