/**
 * ═══════════════════════════════════════════════════════════════
 *  Health Watch v2 - Frame Codec
 *  ترميز/فك ترميز الـ Binary Frame (FCAF) للبروتوكول الجديد
 * ═══════════════════════════════════════════════════════════════
 *
 * Frame format:
 *   | 2 bytes start (0xFC 0xAF) | 2 bytes length (big-endian uint16) | JSON payload |
 *
 * Total packet size = 4 + length
 */

const FRAME_START = Buffer.from([0xFC, 0xAF]);
const HEADER_SIZE = 4;
const MAX_PAYLOAD = 1024 * 1024; // 1 MB حد أقصى احتياطاً

/**
 * Encode JSON object → binary frame
 * @param {object|string} payload  — JSON object or pre-serialized JSON string
 * @returns {Buffer}
 */
function encode(payload) {
  const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const body = Buffer.from(jsonStr, 'utf8');

  if (body.length > 0xFFFF) {
    throw new Error(`v2 frame payload too large: ${body.length} bytes (max 65535)`);
  }

  const header = Buffer.alloc(HEADER_SIZE);
  FRAME_START.copy(header, 0);
  header.writeUInt16BE(body.length, 2);

  return Buffer.concat([header, body], HEADER_SIZE + body.length);
}

/**
 * Stateful frame assembler.
 *
 * يستقبل البايتات تباعاً من TCP socket ويُعيد frame واحد كامل (أو أكثر)
 * لما تكتمل بياناته. يتجاهل أي بايتات قبل أول FCAF (resync).
 */
class FrameAssembler {
  constructor() {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Push new chunk and pull all complete frames.
   * @param {Buffer} chunk
   * @returns {Array<{ payload: Buffer, json: object|null, raw: Buffer }>}
   */
  push(chunk) {
    if (!chunk || chunk.length === 0) return [];
    this.buffer = this.buffer.length === 0
      ? Buffer.from(chunk)
      : Buffer.concat([this.buffer, chunk]);

    const frames = [];

    while (true) {
      // Resync: ابحث عن FCAF في الـ buffer
      const startIdx = this._findStart();
      if (startIdx < 0) {
        // ما في FCAF — احتفظ بآخر بايت واحد فقط (ممكن FC وننتظر AF)
        if (this.buffer.length > 1) {
          this.buffer = this.buffer.slice(this.buffer.length - 1);
        }
        break;
      }

      // تخلص من أي garbage قبل الـ start
      if (startIdx > 0) {
        this.buffer = this.buffer.slice(startIdx);
      }

      // نحتاج 4 بايت للـ header كاملاً
      if (this.buffer.length < HEADER_SIZE) break;

      const length = this.buffer.readUInt16BE(2);

      if (length > MAX_PAYLOAD) {
        // Length غير معقولة → اعتبرها corrupt واتخطى البداية للبحث عن FCAF التالي
        this.buffer = this.buffer.slice(2);
        continue;
      }

      const total = HEADER_SIZE + length;
      if (this.buffer.length < total) break; // ناقص بيانات

      const raw = this.buffer.slice(0, total);
      const payload = this.buffer.slice(HEADER_SIZE, total);
      this.buffer = this.buffer.slice(total);

      let json = null;
      try {
        json = JSON.parse(payload.toString('utf8'));
      } catch (_err) {
        json = null; // الـ caller يقدر يلاحظ ويتعامل
      }

      frames.push({ payload, json, raw });
    }

    return frames;
  }

  _findStart() {
    return this.buffer.indexOf(FRAME_START);
  }

  reset() {
    this.buffer = Buffer.alloc(0);
  }

  get pendingBytes() {
    return this.buffer.length;
  }
}

module.exports = {
  FRAME_START,
  HEADER_SIZE,
  encode,
  FrameAssembler,
};
