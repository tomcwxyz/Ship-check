const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const iconDirectory = path.join(root, 'apps/desktop/src-tauri/icons');
const pngSource = path.join(iconDirectory, 'icon.png.b64');
const pngDestination = path.join(iconDirectory, 'icon.png');
const icoDestination = path.join(iconDirectory, 'icon.ico');

if (!fs.existsSync(pngSource)) {
  throw new Error(`Missing desktop icon source: ${pngSource}`);
}

const png = Buffer.from(fs.readFileSync(pngSource, 'utf8').trim(), 'base64');
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

if (png.length < 24 || !png.subarray(0, 8).equals(pngSignature)) {
  throw new Error('Desktop icon source is not a valid PNG');
}

const pngWidth = png.readUInt32BE(16);
const pngHeight = png.readUInt32BE(20);

if (pngWidth !== 128 || pngHeight !== 128) {
  throw new Error(`Desktop icon source must be 128x128; received ${pngWidth}x${pngHeight}`);
}

fs.mkdirSync(iconDirectory, { recursive: true });
fs.writeFileSync(pngDestination, png);

const colours = {
  transparent: [0, 0, 0, 0],
  orange: [58, 99, 242, 255], // BGRA for #f2633a
  ink: [31, 33, 24, 255], // BGRA for #18211f
};

const pixelFor = (x, y) => {
  // Leave a small transparent gutter so the mark keeps its silhouette in
  // taskbars/docks rather than becoming a full-bleed coloured square.
  if (x < 2 || x > 29 || y < 2 || y > 29) {
    return colours.transparent;
  }

  // Clip the four outermost corners to echo the lightly rounded 128px source.
  if (
    (x === 2 && y === 2) ||
    (x === 29 && y === 2) ||
    (x === 2 && y === 29) ||
    (x === 29 && y === 29)
  ) {
    return colours.transparent;
  }

  const onPlateBorder = x <= 3 || x >= 28 || y <= 3 || y >= 28;
  if (onPlateBorder) {
    return colours.ink;
  }

  // Survey/load-line-inspired ring. Deliberately simple at 32px so it remains
  // legible when Windows renders the icon at 16–24px.
  const centre = 15.5;
  const distance = Math.hypot(x - centre, y - centre);
  const onRing = Math.abs(distance - 7.4) <= 1.0;
  const onLine = y >= 15 && y <= 16 && x >= 6 && x <= 25;

  if (onRing || onLine) {
    return colours.ink;
  }

  return colours.orange;
};

const createIco = () => {
  const width = 32;
  const height = 32;
  const pixelBytes = width * height * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskBytes = maskStride * height;
  const imageBytes = 40 + pixelBytes + maskBytes;
  const imageOffset = 6 + 16;
  const output = Buffer.alloc(imageOffset + imageBytes);

  output.writeUInt16LE(0, 0);
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(1, 4);
  output.writeUInt8(width, 6);
  output.writeUInt8(height, 7);
  output.writeUInt8(0, 8);
  output.writeUInt8(0, 9);
  output.writeUInt16LE(1, 10);
  output.writeUInt16LE(32, 12);
  output.writeUInt32LE(imageBytes, 14);
  output.writeUInt32LE(imageOffset, 18);

  output.writeUInt32LE(40, imageOffset);
  output.writeInt32LE(width, imageOffset + 4);
  output.writeInt32LE(height * 2, imageOffset + 8);
  output.writeUInt16LE(1, imageOffset + 12);
  output.writeUInt16LE(32, imageOffset + 14);
  output.writeUInt32LE(0, imageOffset + 16);
  output.writeUInt32LE(pixelBytes, imageOffset + 20);

  const pixelsStart = imageOffset + 40;
  const maskStart = pixelsStart + pixelBytes;

  for (let dibY = 0; dibY < height; dibY += 1) {
    const y = height - 1 - dibY;

    for (let x = 0; x < width; x += 1) {
      const [blue, green, red, alpha] = pixelFor(x, y);
      const pixelIndex = dibY * width + x;
      const offset = pixelsStart + pixelIndex * 4;

      output[offset] = blue;
      output[offset + 1] = green;
      output[offset + 2] = red;
      output[offset + 3] = alpha;

      if (alpha === 0) {
        const maskOffset = maskStart + dibY * maskStride + Math.floor(x / 8);
        output[maskOffset] |= 1 << (7 - (x % 8));
      }
    }
  }

  return output;
};

fs.writeFileSync(icoDestination, createIco());
console.log(
  `Generated Ship Check survey-mark desktop assets (${pngWidth}x${pngHeight} PNG + 32x32 ICO) in ${iconDirectory}`,
);
