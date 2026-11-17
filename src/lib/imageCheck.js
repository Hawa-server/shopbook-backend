// Checks an uploaded photo using ONLY its bytes (BE6.5). The Content-Type
// header and the file name are never trusted: anyone can call a PNG or an
// SVG "image/jpeg". Written in the project (no image library): we don't
// decode the picture, we only read the few header fields we need.
//
// What it accepts:
// - JPEG (starts FF D8 FF) and WebP (RIFF....WEBP, lossy VP8, lossless VP8L
//   or extended VP8X). Nothing else: SVG is refused on purpose, because an
//   SVG can carry script.
// - At most 300 KB and at most 1,600 px on each side.
// - No EXIF or XMP metadata (where a phone camera puts GPS position, the
//   phone model and the time). The app re-saves every photo through a canvas,
//   which drops them; a photo that still has them means the app skipped that
//   step, and is refused so a shop's location can't leak. HARMLESS headers are
//   allowed: JPEG's JFIF (APP0) and colour profiles (APP2 ICC_PROFILE, WebP
//   ICCP), which canvases write themselves.
//
// inspectImage(bytes) returns { contentType, width, height } or throws a
// PhotoError with the code the API answers.

const MAX_BYTES = 300 * 1024;
const MAX_SIDE = 1600;

// A refusal: `code` is the API error code (see docs/api.md).
class PhotoError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PhotoError';
    this.code = code;
  }
}

const notAllowed = () => new PhotoError('PHOTO_TYPE_NOT_ALLOWED', 'Use a JPEG or WebP photo.');
const tooLarge = () => new PhotoError('PHOTO_TOO_LARGE', `The photo must be at most 300 KB and ${MAX_SIDE} px on each side.`);
const hasMetadata = () => new PhotoError('PHOTO_HAS_METADATA', 'The photo still has camera details (EXIF or XMP). Save it again from the app.');

// The APP1 identifiers that mean EXIF or XMP metadata.
const EXIF_ID = Buffer.from('Exif\0', 'latin1');
const XMP_IDS = [Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'latin1'), Buffer.from('http://ns.adobe.com/xmp/extension/\0', 'latin1')];

// Walks a JPEG's segments up to the start of the picture data: refuses
// EXIF/XMP, and reads the size from the frame header (SOFn).
function inspectJpeg(b) {
  let i = 2;
  let size = null;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) throw notAllowed(); // not a well-formed JPEG
    const marker = b[i + 1];
    if (marker === 0xff) { i += 1; continue; } // padding
    if (marker === 0xd9 || marker === 0xda) break; // end of image / start of scan: headers are over
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; } // markers without a length
    const length = b.readUInt16BE(i + 2);
    if (length < 2 || i + 2 + length > b.length) throw notAllowed();
    const data = b.subarray(i + 4, i + 2 + length);
    if (marker === 0xe1 && (data.subarray(0, EXIF_ID.length).equals(EXIF_ID) || XMP_IDS.some((id) => data.subarray(0, id.length).equals(id)))) {
      throw hasMetadata();
    }
    // Frame headers: C0–CF except C4 (Huffman tables), C8 (reserved), CC (arithmetic coding).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker) && data.length >= 5) {
      size = { height: data.readUInt16BE(1), width: data.readUInt16BE(3) };
    }
    i += 2 + length;
  }
  if (!size || size.width === 0 || size.height === 0) throw notAllowed();
  return { contentType: 'image/jpeg', ...size };
}

// Walks a WebP's chunks: refuses EXIF/XMP chunks, and reads the size from
// VP8X (extended), VP8 (lossy) or VP8L (lossless).
function inspectWebp(b) {
  if (b.readUInt32LE(4) + 8 !== b.length) throw notAllowed(); // the RIFF length must match the file
  let i = 12;
  let size = null;
  let hasImage = false;
  while (i + 8 <= b.length) {
    const name = b.toString('latin1', i, i + 4);
    const length = b.readUInt32LE(i + 4);
    const data = b.subarray(i + 8, i + 8 + length);
    if (data.length !== length) throw notAllowed();
    if (name === 'EXIF' || name === 'XMP ') throw hasMetadata();
    if (name === 'VP8X' && length >= 10) {
      size = { width: 1 + data.readUIntLE(4, 3), height: 1 + data.readUIntLE(7, 3) };
    } else if (name === 'VP8 ' && length >= 10) {
      hasImage = true;
      if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) throw notAllowed();
      size ??= { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff };
    } else if (name === 'VP8L' && length >= 5) {
      hasImage = true;
      if (data[0] !== 0x2f) throw notAllowed();
      const bits = data.readUInt32LE(1);
      size ??= { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    } else if (name === 'ANIM' || name === 'ANMF') {
      throw notAllowed(); // animated WebP: not a product photo
    }
    i += 8 + length + (length & 1); // chunks are padded to an even length
  }
  if (!hasImage || !size || size.width === 0 || size.height === 0) throw notAllowed();
  return { contentType: 'image/webp', ...size };
}

// Checks one upload. `bytes` is a Buffer (anything else is refused).
function inspectImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw notAllowed();
  if (bytes.length > MAX_BYTES) throw tooLarge();
  let info;
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    info = inspectJpeg(bytes);
  } else if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    info = inspectWebp(bytes);
  } else {
    throw notAllowed();
  }
  if (info.width > MAX_SIDE || info.height > MAX_SIDE) throw tooLarge();
  return info;
}

module.exports = { inspectImage, PhotoError, MAX_BYTES, MAX_SIDE };
