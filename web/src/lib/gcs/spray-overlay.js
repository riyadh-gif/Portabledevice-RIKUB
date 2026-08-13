// Colour + dose model for the realtime sprayed-area overlay on the Monitoring
// page. The reactive sprayer drives two independent pumps (see
// docs/drone_api.md → "Spraying pipeline"); we treat each pump as one drug:
//
//   right pump  → Fungisida   (cyan ramp)
//   left  pump  → Insektisida (amber ramp)
//   both active → a distinct violet ramp
//
// Each sprayed sample is painted in its drug's hue, shaded by the live measured
// flow so heavier dosing reads darker. Pure module — no React, no Leaflet — so
// the same mapping is shared by the flight-plan hand-off and the overlay legend.

/** Default per-liquid application rate (L/ha) assigned when a zone selects a
 *  drug but the UI never captured a numeric dose. */
export const DEFAULT_RATE_LPHA = 50;

/** Fallback nozzle swath width (m) when neither the mission nor status reports one. */
export const DEFAULT_SWATH_M = 4;

/** Which drug each pump lays down, plus its low→high colour ramp. */
export const PUMP_DRUGS = {
  right: { key: "fungisida", label: "Fungisida", ramp: ["#67e8f9", "#22d3ee", "#0891b2"] },
  left: { key: "insektisida", label: "Insektisida", ramp: ["#fcd34d", "#f59e0b", "#b45309"] },
};

/** Ramp used where both liquids are applied on the same spot. */
export const BOTH_DRUG = { label: "Keduanya", ramp: ["#c4b5fd", "#8b5cf6", "#6d28d9"] };

/**
 * Selected chambers (drug keys) → per-pump application rates (L/ha).
 *
 * `doses` is either a per-chamber map captured in the UI (e.g.
 * `{ fungisida: 40, insektisida: 60 }`) or a single numeric base rate applied to
 * every selected pump. A missing / non-positive entry falls back to
 * DEFAULT_RATE_LPHA so a selected chamber is never sprayed at zero.
 */
export function ratesFromChambers(chambers, doses = DEFAULT_RATE_LPHA) {
  const selected = new Set(Array.isArray(chambers) ? chambers : []);
  const rateFor = (key) => {
    const raw =
      doses && typeof doses === "object" && !Array.isArray(doses) ? doses[key] : doses;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_RATE_LPHA;
  };
  return {
    right: selected.has(PUMP_DRUGS.right.key) ? rateFor(PUMP_DRUGS.right.key) : 0,
    left: selected.has(PUMP_DRUGS.left.key) ? rateFor(PUMP_DRUGS.left.key) : 0,
  };
}

/** A pump counts as actively spraying when it is commanded or measuring flow. */
function pumpActive(pump) {
  if (!pump) return false;
  if (Number.isFinite(pump.measured_lpm) && pump.measured_lpm > 0.01) return true;
  if (Number.isFinite(pump.target_lpm) && pump.target_lpm > 0.001) return true;
  return pump.on === true;
}

/** Best available flow figure (L/min) for a pump — measured, else commanded. */
function pumpFlow(pump) {
  if (!pump) return 0;
  if (Number.isFinite(pump.measured_lpm) && pump.measured_lpm > 0) return pump.measured_lpm;
  if (Number.isFinite(pump.target_lpm)) return pump.target_lpm;
  return 0;
}

/** Bucket a flow rate (L/min) into a 0..2 shade index for the drug ramp. */
export function flowShade(lpm) {
  if (lpm >= 1.2) return 2;
  if (lpm >= 0.4) return 1;
  return 0;
}

/**
 * Classify one sprayed sample into a paint style for the overlay.
 * @returns {{ paint: false } | { paint: true, color: string, shade: number, drugs: string[] }}
 */
export function classifySample(sample) {
  const right = sample?.right;
  const left = sample?.left;
  const rightOn = pumpActive(right);
  const leftOn = pumpActive(left);
  if (!rightOn && !leftOn) return { paint: false };

  const shade = flowShade(Math.max(rightOn ? pumpFlow(right) : 0, leftOn ? pumpFlow(left) : 0));

  let drug;
  if (rightOn && leftOn) drug = { ramp: BOTH_DRUG.ramp, drugs: [PUMP_DRUGS.right.label, PUMP_DRUGS.left.label] };
  else if (rightOn) drug = { ramp: PUMP_DRUGS.right.ramp, drugs: [PUMP_DRUGS.right.label] };
  else drug = { ramp: PUMP_DRUGS.left.ramp, drugs: [PUMP_DRUGS.left.label] };

  return { paint: true, color: drug.ramp[shade], shade, drugs: drug.drugs };
}

/** Leaflet vector style for a classified sample's swath dot. */
export function sampleLeafletStyle(color) {
  return { stroke: false, weight: 0, fillColor: color, fillOpacity: 0.5 };
}

/**
 * Legend rows for the drugs present in a mission. When `chambers` is null/unknown
 * the full two-drug legend is shown.
 */
export function legendItems(chambers) {
  const known = Array.isArray(chambers);
  const selected = new Set(known ? chambers : []);
  const rows = [];
  for (const pump of ["right", "left"]) {
    const drug = PUMP_DRUGS[pump];
    if (!known || selected.has(drug.key)) rows.push({ label: drug.label, ramp: drug.ramp });
  }
  if (rows.length === 2) rows.push({ label: BOTH_DRUG.label, ramp: BOTH_DRUG.ramp });
  return rows;
}
