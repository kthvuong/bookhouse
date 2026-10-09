/* ============================================================
   qr.js — draws a QR code for a short piece of text (the device
   link in Settings). Byte mode, error-correction level L, versions
   1 to 10: room for 271 characters, far more than a link needs.

   QR.matrix(text) → rows of booleans (true = dark)
   QR.svg(text)    → an <svg> string, always dark on white so a
                     camera can read it in the dark theme too
   ============================================================ */

const QR = (() => {
  // Per version at level L: [error-correction bytes per block, blocks, bytes in all]
  const SHAPE = [null, [7, 1, 26], [10, 1, 44], [15, 1, 70], [20, 1, 100], [26, 1, 134],
    [18, 2, 172], [20, 2, 196], [24, 2, 242], [30, 2, 292], [18, 4, 346]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  const dataBytes = (v) => SHAPE[v][2] - SHAPE[v][0] * SHAPE[v][1];
  const countBits = (v) => (v < 10 ? 8 : 16);

  // ---- Reed-Solomon over GF(256) ----
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function divisor(degree) {
    const out = new Array(degree).fill(0);
    out[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        out[j] = mul(out[j], root);
        if (j + 1 < degree) out[j] ^= out[j + 1];
      }
      root = mul(root, 2);
    }
    return out;
  }
  function remainder(data, div) {
    const out = div.map(() => 0);
    for (const b of data) {
      const factor = b ^ out.shift();
      out.push(0);
      div.forEach((c, i) => { out[i] ^= mul(c, factor); });
    }
    return out;
  }

  /** The text as the code's full run of bytes: data, padding, then the
   *  error-correction bytes, with the blocks interleaved. */
  function codewords(bytes, v) {
    const bits = [];
    const push = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
    push(4, 4); // byte mode
    push(bytes.length, countBits(v));
    bytes.forEach((b) => push(b, 8));
    const capacity = dataBytes(v) * 8;
    push(0, Math.min(4, capacity - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (let pad = 0xEC; bits.length < capacity; pad ^= 0xEC ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));

    const [ecLen, blockCount, total] = SHAPE[v];
    const shortLen = Math.floor(total / blockCount) - ecLen;
    const shortBlocks = blockCount - (total % blockCount);
    const div = divisor(ecLen);
    const blocks = [];
    for (let i = 0, at = 0; i < blockCount; i++) {
      const len = shortLen + (i < shortBlocks ? 0 : 1);
      const part = data.slice(at, at + len);
      at += len;
      blocks.push({ data: part, ec: remainder(part, div) });
    }
    const out = [];
    for (let i = 0; i <= shortLen; i++) blocks.forEach((b) => { if (i < b.data.length) out.push(b.data[i]); });
    for (let i = 0; i < ecLen; i++) blocks.forEach((b) => out.push(b.ec[i]));
    return out;
  }

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ];

  /** How hard a finished code is to read, by the standard's four rules;
   *  the mask with the lowest score is the one used. */
  function penalty(m) {
    const size = m.length;
    let score = 0;
    const lines = [];
    for (let i = 0; i < size; i++) {
      lines.push(m[i]);
      lines.push(m.map((row) => row[i]));
    }
    for (const line of lines) {
      for (let i = 0, run = 1; i < size; i++, run++) {
        if (i + 1 === size || line[i + 1] !== line[i]) {
          if (run >= 5) score += run - 2;
          run = 0;
        }
      }
      const s = line.map((d) => (d ? 1 : 0)).join('');
      for (const pattern of ['10111010000', '00001011101']) {
        for (let at = s.indexOf(pattern); at >= 0; at = s.indexOf(pattern, at + 1)) score += 40;
      }
    }
    let dark = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (m[y][x]) dark++;
        if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
      }
    }
    return score + Math.floor(Math.abs((dark * 20) / (size * size) - 10)) * 10;
  }

  function build(v, data, mask) {
    const size = 17 + 4 * v;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
    const set = (x, y, dark) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      m[y][x] = !!dark;
      fixed[y][x] = true;
    };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, d !== 2 && d !== 4);
        }
      }
    }
    const at = ALIGN[v];
    at.forEach((cx, i) => at.forEach((cy, j) => {
      const last = at.length - 1;
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }));

    // Format: level L (01) and the mask, with their own error correction.
    const format = (1 << 3) | mask;
    let rem = format;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fbits = ((format << 10) | rem) ^ 0x5412;
    const fbit = (i) => ((fbits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) set(8, i, fbit(i));
    set(8, 7, fbit(6));
    set(8, 8, fbit(7));
    set(7, 8, fbit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, fbit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, fbit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, fbit(i));
    set(8, size - 8, true);

    if (v >= 7) {
      let vrem = v;
      for (let i = 0; i < 12; i++) vrem = (vrem << 1) ^ ((vrem >>> 11) * 0x1F25);
      const vbits = (v << 12) | vrem;
      for (let i = 0; i < 18; i++) {
        const dark = ((vbits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        set(a, b, dark);
        set(b, a, dark);
      }
    }

    // The data snakes up and down in two-module columns from the bottom right.
    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? size - 1 - vert : vert;
          if (fixed[y][x]) continue;
          const dark = i < data.length * 8 && ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          m[y][x] = dark !== MASKS[mask](x, y);
          i++;
        }
      }
    }
    return m;
  }

  function matrix(text) {
    const bytes = [...new TextEncoder().encode(String(text))];
    let v = 1;
    while (v <= 10 && bytes.length > dataBytes(v) - (countBits(v) === 8 ? 2 : 3)) v++;
    if (v > 10) throw new Error('Too long for a QR code here');
    const data = codewords(bytes, v);
    let best = null;
    for (let mask = 0; mask < 8; mask++) {
      const m = build(v, data, mask);
      const score = penalty(m);
      if (!best || score < best.score) best = { m, score };
    }
    return best.m;
  }

  function svg(text) {
    const m = matrix(text);
    const quiet = 4;
    const size = m.length + quiet * 2;
    let d = '';
    m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  return { matrix, svg };
})();
