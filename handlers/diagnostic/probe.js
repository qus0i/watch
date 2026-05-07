/**
 * ═══════════════════════════════════════════════════════════════
 *  Diagnostic Probe (THROWAWAY)
 *  Captures up to 500 bytes from connections that don't match the
 *  legacy IW (0x49) or v2 FCAF (0xFC 0xAF) protocols, so we can
 *  identify what unknown devices (e.g., HW20 PRO) are sending.
 *
 *  This file is meant to be deleted once the protocol is identified.
 *  No DB, no parsing, no replies — just observe and log.
 * ═══════════════════════════════════════════════════════════════
 */

const MAX_CAPTURE_BYTES = 500;
const CAPTURE_TIMEOUT_MS = 5000;

function diagLog(msg) {
  console.log(`🔬 [DIAGNOSTIC] ${msg}`);
}

function diagError(msg) {
  console.log(`🔬 [DIAGNOSTIC ERROR] ${msg}`);
}

function isPrintable(b) {
  return b >= 0x20 && b <= 0x7e;
}

function formatHexDump(buf) {
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const slice = buf.slice(i, i + 16);
    const offset = i.toString(16).padStart(8, '0');
    const hexCells = [];
    for (let j = 0; j < 16; j++) {
      hexCells.push(j < slice.length ? slice[j].toString(16).padStart(2, '0') : '  ');
    }
    const hex = hexCells.slice(0, 8).join(' ') + '  ' + hexCells.slice(8).join(' ');
    const ascii = Array.from(slice)
      .map((b) => (isPrintable(b) ? String.fromCharCode(b) : '.'))
      .join('');
    lines.push(`${offset}  ${hex}  |${ascii}|`);
  }
  return lines.join('\n');
}

function formatAscii(buf) {
  return Array.from(buf)
    .map((b) => (isPrintable(b) ? String.fromCharCode(b) : '.'))
    .join('');
}

function bestGuess(buf) {
  if (buf.length === 0) return 'No data captured';
  const head = buf.slice(0, Math.min(8, buf.length)).toString('latin1');
  if (head.startsWith('GET ') || head.startsWith('POST ') || head.startsWith('HTTP')) {
    return "→ matched 'GET '/'POST '/'HTTP': likely HTTP or WebSocket handshake";
  }
  if (buf.length >= 2 && buf[0] === 0x16 && buf[1] === 0x03) {
    return '→ matched 0x16 0x03: likely TLS/SSL handshake';
  }
  if (buf.length >= 2 && buf[0] === 0xFC && buf[1] === 0xAF) {
    return '→ matched 0xFC 0xAF: v2 FCAF (should NOT reach diagnostic — flag this!)';
  }
  if (buf[0] === 0x49) {
    return "→ matched 'I' (0x49): legacy IW (should NOT reach diagnostic — flag this!)";
  }
  return '→ no known prefix matched: unknown binary protocol';
}

function handleDiagnosticConnection(socket, firstByte) {
  let finished = false;
  const chunks = [];
  let total = 0;
  let timer = null;

  try {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    const hex = firstByte.toString(16).padStart(2, '0').toUpperCase();
    const charDisplay = isPrintable(firstByte)
      ? String.fromCharCode(firstByte)
      : 'NULL';

    diagLog('Unknown protocol detected');
    diagLog(`Remote: ${remote}`);
    diagLog(
      `First byte: 0x${hex} (decimal: ${firstByte}, char: '${charDisplay}')`
    );
    diagLog(`Timestamp: ${new Date().toISOString()}`);

    const finish = (reason) => {
      if (finished) return;
      finished = true;

      try { if (timer) clearTimeout(timer); } catch (_) { /* ignore */ }
      try { socket.removeListener('data', onData); } catch (_) { /* ignore */ }
      try { socket.removeListener('end', onEnd); } catch (_) { /* ignore */ }
      try { socket.removeListener('close', onClose); } catch (_) { /* ignore */ }
      try { socket.removeListener('error', onError); } catch (_) { /* ignore */ }

      try {
        const buf = Buffer.concat(chunks, total);
        diagLog(`Capture finished (reason: ${reason})`);
        diagLog(`Captured ${buf.length} bytes:`);
        diagLog('HEX:');
        if (buf.length > 0) {
          console.log(formatHexDump(buf));
        } else {
          console.log('  (no bytes captured)');
        }
        diagLog("ASCII (printable chars only, '.' for non-printable):");
        console.log(formatAscii(buf));
        diagLog('Possible protocol guesses:');
        console.log("  - Starts with 'GET ' or 'POST ' or 'HTTP' → likely HTTP/WebSocket handshake");
        console.log('  - Starts with 0x16 0x03 → likely TLS handshake');
        console.log('  - Starts with 0xFC 0xAF → v2 FCAF (should not reach here, but flag if seen)');
        console.log("  - Starts with 'I' → legacy IW (should not reach here, but flag if seen)");
        console.log('  - Otherwise → unknown binary protocol');
        diagLog(bestGuess(buf));
      } catch (err) {
        diagError(`failed to dump capture: ${err.message}`);
      }

      try { socket.end(); } catch (_) { /* ignore */ }
    };

    const onData = (chunk) => {
      try {
        if (finished) return;
        const remaining = MAX_CAPTURE_BYTES - total;
        if (remaining <= 0) {
          finish('buffer-full');
          return;
        }
        const slice = chunk.length <= remaining ? chunk : chunk.slice(0, remaining);
        chunks.push(slice);
        total += slice.length;
        if (total >= MAX_CAPTURE_BYTES) {
          finish('buffer-full');
        }
      } catch (err) {
        diagError(`onData failed: ${err.message}`);
        finish('data-error');
      }
    };

    const onEnd = () => finish('socket-end');
    const onClose = () => finish('socket-close');
    const onError = (err) => {
      diagError(`socket error: ${err && err.message ? err.message : err}`);
      finish('socket-error');
    };

    timer = setTimeout(() => finish('timeout'), CAPTURE_TIMEOUT_MS);

    socket.on('data', onData);
    socket.on('end', onEnd);
    socket.on('close', onClose);
    socket.on('error', onError);
  } catch (err) {
    diagError(err && err.message ? err.message : String(err));
    try { socket.end(); } catch (_) { /* ignore */ }
  }
}

module.exports = { handleDiagnosticConnection };
