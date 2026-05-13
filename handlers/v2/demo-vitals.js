/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Galaxy — server-side demo vitals (feature-flagged)
 * ═══════════════════════════════════════════════════════════════
 *
 * Synthesizes SpO2 / BP / body-temperature values whenever a Galaxy
 * upHeartRate frame arrives. Galaxy watches cannot produce these
 * through Health Services + Samsung SDK, but the HR sensor only
 * fires when the optical PPG has skin contact, so HR-present is a
 * reliable "user is wearing the watch" signal.
 *
 * Gated by env var DEMO_VITALS_ENABLED in the caller — flipping the
 * Railway variable takes effect on the next HR frame, no redeploy.
 *
 * Per-IMEI state lives in-process only. Restart resets to baseline.
 * No DB writes from this module; it only returns numbers.
 */

const METRICS = {
  spo2:        { baseline: 97,   min: 95,   max: 99,   drift: 0.05, round: 'int' },
  systolic:    { baseline: 118,  min: 105,  max: 135,  drift: 0.3,  round: 'int' },
  diastolic:   { baseline: 76,   min: 65,   max: 88,   drift: 0.2,  round: 'int' },
  temperature: { baseline: 36.7, min: 36.3, max: 37.1, drift: 0.01, round: 'one' },
};

const stateByImei = new Map();

function _initState() {
  const s = {};
  for (const [name, m] of Object.entries(METRICS)) {
    s[name] = m.baseline;
  }
  return s;
}

function _step(value, m) {
  const delta = (Math.random() * 2 - 1) * m.drift;
  let next = value + delta;
  if (next < m.min) next = m.min;
  if (next > m.max) next = m.max;
  return next;
}

function _round(value, mode) {
  return mode === 'int' ? Math.round(value) : Math.round(value * 10) / 10;
}

function generateDemoVitals(imei) {
  let state = stateByImei.get(imei);
  if (!state) {
    state = _initState();
    stateByImei.set(imei, state);
  }
  const out = {};
  for (const [name, m] of Object.entries(METRICS)) {
    state[name] = _step(state[name], m);
    out[name] = _round(state[name], m.round);
  }
  return out;
}

module.exports = { generateDemoVitals };
