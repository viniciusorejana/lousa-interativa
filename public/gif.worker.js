/**
 * gif.worker.js
 * Decodifica GIFs fora da thread principal usando um <canvas> offscreen
 * e envia os frames prontos (ImageBitmap + delays) via postMessage.
 *
 * Protocolo de mensagens:
 *   Recebe: { id, url }
 *   Envia:  { id, frames: [ { bitmap: ImageBitmap, delay: number(ms) } ] }
 *   Erro:   { id, error: string }
 */

/**
 * Parser GIF mínimo e robusto — interpreta o binário do GIF89a/87a
 * completamente dentro do Worker, sem depender de bibliotecas externas.
 */

// ── Helpers de leitura de stream ─────────────────────────────────────────────

class ByteReader {
  constructor(buf) {
    this.v = new Uint8Array(buf);
    this.p = 0;
  }
  u8()  { return this.v[this.p++]; }
  u16() { const a = this.v[this.p++], b = this.v[this.p++]; return a | (b << 8); }
  skip(n) { this.p += n; }
  read(n) { const s = this.v.subarray(this.p, this.p + n); this.p += n; return s; }
  peek() { return this.v[this.p]; }
  eof() { return this.p >= this.v.length; }
  // Lê sub-blocks encadeados (Data Sub-blocks do GIF) e retorna Uint8Array concatenado
  readSubBlocks() {
    const chunks = [];
    let total = 0;
    while (!this.eof()) {
      const size = this.u8();
      if (size === 0) break;
      chunks.push(this.read(size));
      total += size;
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
}

// ── Decodificador LZW ─────────────────────────────────────────────────────────

function decodeLZW(minCodeSize, data) {
  const clearCode = 1 << minCodeSize;
  const eofCode   = clearCode + 1;
  let   codeSize  = minCodeSize + 1;
  let   nextCode  = eofCode + 1;

  // Tabela de códigos
  const MAX_CODES = 4096;
  const prefix = new Int32Array(MAX_CODES).fill(-1);
  const suffix = new Uint8Array(MAX_CODES);
  const stack  = new Uint8Array(MAX_CODES);

  function initTable() {
    for (let i = 0; i < clearCode; i++) { prefix[i] = -1; suffix[i] = i; }
    nextCode = eofCode + 1;
    codeSize = minCodeSize + 1;
  }

  initTable();

  const pixels = [];
  let stackTop = 0;
  let prevCode = -1;
  let firstByte = 0;

  // Leitor de bits
  let bitBuf = 0, bitsLeft = 0, dataPos = 0;

  function readCode() {
    while (bitsLeft < codeSize) {
      if (dataPos >= data.length) return eofCode;
      bitBuf |= data[dataPos++] << bitsLeft;
      bitsLeft += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>= codeSize;
    bitsLeft -= codeSize;
    return code;
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const code = readCode();
    if (code === eofCode || dataPos > data.length + 2) break;

    if (code === clearCode) {
      initTable();
      prevCode = -1;
      continue;
    }

    let cur = code;
    stackTop = 0;

    if (cur >= nextCode) {
      // código ainda não na tabela
      stack[stackTop++] = firstByte;
      cur = prevCode;
    }

    while (cur >= clearCode) {
      stack[stackTop++] = suffix[cur];
      cur = prefix[cur];
    }
    firstByte = suffix[cur];
    stack[stackTop++] = firstByte;

    // despeja da pilha para pixels (ordem reversa)
    for (let i = stackTop - 1; i >= 0; i--) pixels.push(stack[i]);

    if (prevCode !== -1 && nextCode < MAX_CODES) {
      prefix[nextCode] = prevCode;
      suffix[nextCode] = firstByte;
      nextCode++;
      if (nextCode === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prevCode = code;
  }

  return new Uint8Array(pixels);
}

// ── Parser GIF ────────────────────────────────────────────────────────────────

function parseGIF(buffer) {
  const r = new ByteReader(buffer);

  // Assinatura
  const sig = String.fromCharCode(...r.read(6));
  if (!sig.startsWith('GIF')) throw new Error('Não é um GIF válido');

  // Logical Screen Descriptor
  const canvasW = r.u16();
  const canvasH = r.u16();
  const packed  = r.u8();
  const hasCT   = (packed >> 7) & 1;
  const ctSize  = 2 << (packed & 0x7);
  r.skip(2); // bg color index + pixel aspect

  // Global Color Table
  let globalCT = null;
  if (hasCT) {
    globalCT = r.read(ctSize * 3);
  }

  const frames = [];
  let gce = null; // Graphic Control Extension atual

  while (!r.eof()) {
    const sentinel = r.u8();

    if (sentinel === 0x3B) break; // Trailer

    if (sentinel === 0x21) {
      // Extension
      const label = r.u8();

      if (label === 0xF9) {
        // Graphic Control Extension
        r.skip(1); // block size (always 4)
        const gPacked    = r.u8();
        const delayCs    = r.u16(); // centisegundos
        const transpIdx  = r.u8();
        r.skip(1); // block terminator
        gce = {
          disposal:     (gPacked >> 3) & 0x7,
          hasTransp:    !!(gPacked & 0x1),
          transpIdx,
          delayMs:      Math.max(delayCs * 10, 20), // mínimo 20ms
        };
      } else {
        // Outros extensions — descarta sub-blocks
        r.readSubBlocks();
      }
      continue;
    }

    if (sentinel === 0x2C) {
      // Image Descriptor
      const imgLeft = r.u16();
      const imgTop  = r.u16();
      const imgW    = r.u16();
      const imgH    = r.u16();
      const iPacked = r.u8();
      const hasLCT  = (iPacked >> 7) & 1;
      const interlaced = (iPacked >> 6) & 1;
      const lctSize = 2 << (iPacked & 0x7);

      let ct = globalCT;
      if (hasLCT) {
        ct = r.read(lctSize * 3);
      }

      const minCode = r.u8();
      const lzwData = r.readSubBlocks();
      const indices = decodeLZW(minCode, lzwData);

      frames.push({
        left: imgLeft, top: imgTop, w: imgW, h: imgH,
        indices, interlaced,
        ct, gce: gce || { disposal: 0, hasTransp: false, transpIdx: 0, delayMs: 100 },
      });
      gce = null;
      continue;
    }

    // Byte inesperado — tenta continuar
  }

  return { canvasW, canvasH, frames };
}

// ── Renderização de frames ─────────────────────────────────────────────────────

async function renderFrames(gif) {
  const { canvasW, canvasH, frames } = gif;

  // "compose" é o canvas de trabalho — NUNCA transferimos ele.
  // Mantemos o estado acumulado aqui entre frames.
  const compose = new OffscreenCanvas(canvasW, canvasH);
  const ctx     = compose.getContext('2d');

  // Canvas auxiliar para snapshot de disposal=3 ("restore to previous")
  const prevSnap    = new OffscreenCanvas(canvasW, canvasH);
  const prevSnapCtx = prevSnap.getContext('2d');

  // Canvas de saída: usado apenas para gerar o ImageBitmap via
  // transferToImageBitmap() sem tocar no compose.
  const output    = new OffscreenCanvas(canvasW, canvasH);
  const outputCtx = output.getContext('2d');

  const result = [];

  for (let fi = 0; fi < frames.length; fi++) {
    const f   = frames[fi];
    const gce = f.gce;

    // — Guarda snapshot ANTES de desenhar, se este frame pede disposal=3
    if (gce.disposal === 3) {
      prevSnapCtx.clearRect(0, 0, canvasW, canvasH);
      prevSnapCtx.drawImage(compose, 0, 0);
    }

    // — Aplica disposal do frame ANTERIOR
    if (fi > 0) {
      const prevDisposal = frames[fi - 1].gce.disposal;
      if (prevDisposal === 2) {
        // Limpa a área que o frame anterior ocupava
        const pf = frames[fi - 1];
        ctx.clearRect(pf.left, pf.top, pf.w, pf.h);
      } else if (prevDisposal === 3) {
        // Restaura o snapshot salvo antes do frame anterior
        ctx.clearRect(0, 0, canvasW, canvasH);
        ctx.drawImage(prevSnap, 0, 0);
      }
      // disposal 0 ou 1: mantém o compose como está
    }

    // — Deinterlace se necessário
    let indices = f.indices;
    if (f.interlaced) {
      const deint = new Uint8Array(f.w * f.h);
      const passes = [
        { start: 0, step: 8 },
        { start: 4, step: 8 },
        { start: 2, step: 4 },
        { start: 1, step: 2 },
      ];
      let src = 0;
      for (const pass of passes) {
        for (let y = pass.start; y < f.h; y += pass.step) {
          for (let x = 0; x < f.w; x++) {
            deint[y * f.w + x] = indices[src++];
          }
        }
      }
      indices = deint;
    }

    // — Constrói ImageData do frame e pinta no compose
    const imgData = ctx.createImageData(f.w, f.h);
    const d  = imgData.data;
    const ct = f.ct;

    for (let i = 0; i < f.w * f.h; i++) {
      const idx = indices[i];
      const p   = i * 4;
      if (gce.hasTransp && idx === gce.transpIdx) {
        // Pixel transparente: não sobrescreve o que está abaixo no compose.
        // putImageData substitui pixels incondicionalmente, então precisamos
        // copiar o pixel atual do compose para preservar o fundo.
        // Fazemos isso zerando e usando globalCompositeOperation mais abaixo.
        d[p] = d[p+1] = d[p+2] = d[p+3] = 0;
      } else {
        const ci = idx * 3;
        d[p]   = ct[ci];
        d[p+1] = ct[ci+1];
        d[p+2] = ct[ci+2];
        d[p+3] = 255;
      }
    }

    // putImageData ignora globalCompositeOperation e alpha — ele substitui
    // os pixels diretamente. Para respeitar transparência do GIF sobre o
    // fundo acumulado, pintamos o frame num canvas temporário e depois
    // fazemos drawImage com 'source-over' no compose.
    const tmp    = new OffscreenCanvas(f.w, f.h);
    const tmpCtx = tmp.getContext('2d');
    tmpCtx.putImageData(imgData, 0, 0);

    ctx.drawImage(tmp, f.left, f.top);

    // — Captura o compose atual num ImageBitmap para a thread principal.
    // Usamos o canvas "output" para não destruir o "compose".
    outputCtx.clearRect(0, 0, canvasW, canvasH);
    outputCtx.drawImage(compose, 0, 0);
    const bitmap = output.transferToImageBitmap();
    // Após transferToImageBitmap o output fica limpo — ok, só o usamos para captura.

    result.push({ bitmap, delay: gce.delayMs });
  }

  return result;
}

// ── Handler de mensagens ──────────────────────────────────────────────────────

self.onmessage = async function(e) {
  const { id, url } = e.data;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = await res.arrayBuffer();
    const gif    = parseGIF(buffer);
    const frames = await renderFrames(gif);

    // Transfere os bitmaps sem cópia
    self.postMessage(
      { id, frames, canvasW: gif.canvasW, canvasH: gif.canvasH },
      frames.map(f => f.bitmap)
    );
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
