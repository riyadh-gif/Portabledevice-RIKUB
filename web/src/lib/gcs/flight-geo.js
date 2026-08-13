import { generateFlightPath } from "@/lib/gcs/path-planner";

// Turns real lat/lng spray-target polygons into a boustrophedon (zig-zag)
// coverage path, driving the existing pixel-agnostic `generateFlightPath`
// engine through a local equirectangular projection so that lane spacing is
// expressed in true metres and the sweep angle is a true compass-ish bearing.

const EARTH_RADIUS_M = 6378137;
const DEG2RAD = Math.PI / 180;

/**
 * Local equirectangular projection around an origin: converts lng/lat <-> local
 * metres (x = east, y = north). Accurate for the small extents of a single field.
 * @param {number} originLng
 * @param {number} originLat
 */
export function makeLocalProjection(originLng, originLat) {
  const metersPerDegLng = Math.cos(originLat * DEG2RAD) * DEG2RAD * EARTH_RADIUS_M;
  const metersPerDegLat = DEG2RAD * EARTH_RADIUS_M;
  return {
    toLocal(lng, lat) {
      return {
        x: (lng - originLng) * metersPerDegLng,
        y: (lat - originLat) * metersPerDegLat,
      };
    },
    toGeo(x, y) {
      return {
        lng: originLng + x / metersPerDegLng,
        lat: originLat + y / metersPerDegLat,
      };
    },
  };
}

function outerRing(geometry) {
  if (!geometry) return null;
  let coords = null;
  if (geometry.type === "Polygon") coords = geometry.coordinates?.[0];
  else if (geometry.type === "MultiPolygon") coords = geometry.coordinates?.[0]?.[0];
  if (!Array.isArray(coords)) return null;
  const ring = coords
    .filter((c) => Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => ({ lng: c[0], lat: c[1] }));
  // GeoJSON rings are closed (first == last); drop the duplicate for the engine.
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first.lng === last.lng && first.lat === last.lat) ring.pop();
  }
  return ring;
}

/**
 * Normalise spray-target GeoJSON features into planning targets.
 * @param {Array} features GeoJSON features with polygon geometry
 * @returns {Array<{id, zoneCode, chambers: string[], chamberDoses: Object, areaM2: number, ring: Array<{lng, lat}>}>}
 */
export function featuresToTargets(features) {
  const targets = [];
  for (const feature of Array.isArray(features) ? features : []) {
    const ring = outerRing(feature?.geometry);
    if (!ring || ring.length < 3) continue;
    const props = feature.properties ?? {};
    targets.push({
      id: props.id ?? props.zone_code ?? targets.length,
      zoneCode: props.zone_code ?? null,
      chambers: Array.isArray(props.selected_chambers) ? props.selected_chambers : [],
      chamberDoses:
        props.chamber_doses && typeof props.chamber_doses === "object" ? props.chamber_doses : {},
      areaM2: Number(props.area_m2) || 0,
      ring,
    });
  }
  return targets;
}

/** Axis-aligned lng/lat bounds + centre of all target vertices. */
export function targetsBounds(targets) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const target of targets) {
    for (const point of target.ring) {
      if (point.lng < minLng) minLng = point.lng;
      if (point.lng > maxLng) maxLng = point.lng;
      if (point.lat < minLat) minLat = point.lat;
      if (point.lat > maxLat) maxLat = point.lat;
    }
  }
  if (!Number.isFinite(minLng)) return null;
  return {
    minLng,
    minLat,
    maxLng,
    maxLat,
    cLng: (minLng + maxLng) / 2,
    cLat: (minLat + maxLat) / 2,
  };
}

/**
 * Sweep angle that runs the lanes along the field's longer axis (fewest turns).
 * Returns degrees in [0, 180): 0 = east-west lanes, 90 = north-south lanes.
 */
export function defaultAngleDeg(targets) {
  const bounds = targetsBounds(targets);
  if (!bounds) return 0;
  const proj = makeLocalProjection(bounds.cLng, bounds.cLat);
  const eastExtent = Math.abs(
    proj.toLocal(bounds.maxLng, bounds.cLat).x - proj.toLocal(bounds.minLng, bounds.cLat).x,
  );
  const northExtent = Math.abs(
    proj.toLocal(bounds.cLng, bounds.maxLat).y - proj.toLocal(bounds.cLng, bounds.minLat).y,
  );
  return eastExtent >= northExtent ? 0 : 90;
}

/** Great-circle distance in metres between two {lat, lng} points. */
export function haversineMeters(a, b) {
  if (!a || !b) return 0;
  const dLat = (b.lat - a.lat) * DEG2RAD;
  const dLng = (b.lng - a.lng) * DEG2RAD;
  const lat1 = a.lat * DEG2RAD;
  const lat2 = b.lat * DEG2RAD;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total ground length of a lat/lng path in metres. */
export function pathLengthMeters(geoPath) {
  let total = 0;
  for (let i = 1; i < geoPath.length; i++) {
    total += haversineMeters(geoPath[i - 1], geoPath[i]);
  }
  return total;
}

/**
 * Generate a coverage flight path over the given targets.
 * @param {object} opts
 * @param {Array} opts.targets normalised targets (see featuresToTargets)
 * @param {Array} [opts.obstacles] no-fly obstacles to exclude/avoid, each either
 *        {kind:"polygon", ring:[{lng,lat}]} (subtracted from the coverage area)
 *        or {kind:"circle", center:{lng,lat}, radiusM:number} (routed around)
 * @param {number} opts.laneSpacing lane spacing / line width, in metres
 * @param {number} opts.angleDeg sweep direction, in degrees
 * @param {{lat:number, lng:number}|null} [opts.startLngLat] seed the traversal
 *        so it begins at the field point nearest this location (e.g. the drone)
 * @returns {{proj, origin, bounds, localPath, geoPath}|null}
 */
export function planFlightPath({ targets, obstacles = [], laneSpacing, angleDeg, startLngLat }) {
  if (!Array.isArray(targets) || targets.length === 0) return null;
  const bounds = targetsBounds(targets);
  if (!bounds) return null;

  const origin = { lng: bounds.cLng, lat: bounds.cLat };
  const proj = makeLocalProjection(origin.lng, origin.lat);

  try {
    const objects = targets.map((target) => ({
      type: "area",
      shape: "polygon",
      id: target.id,
      points: target.ring.map((point) => proj.toLocal(point.lng, point.lat)),
    }));

    for (const obstacle of Array.isArray(obstacles) ? obstacles : []) {
      if (obstacle.kind === "polygon" && Array.isArray(obstacle.ring) && obstacle.ring.length >= 3) {
        objects.push({
          type: "obstacle",
          shape: "polygon",
          points: obstacle.ring.map((point) => proj.toLocal(point.lng, point.lat)),
        });
      } else if (obstacle.kind === "circle" && obstacle.center && obstacle.radiusM > 0) {
        objects.push({
          type: "obstacle",
          shape: "circle",
          points: [proj.toLocal(obstacle.center.lng, obstacle.center.lat)],
          radius: obstacle.radiusM,
        });
      }
    }

    const config = {
      gap: Math.max(0.1, Number(laneSpacing) || 0.1),
      angle: Number(angleDeg) || 0,
      offset: 0,
      invert: false,
    };
    if (startLngLat && Number.isFinite(startLngLat.lat) && Number.isFinite(startLngLat.lng)) {
      config.startPoint = proj.toLocal(startLngLat.lng, startLngLat.lat);
    }

    const localPath = generateFlightPath(objects, config);
    const geoPath = localPath.map((point) => {
      const { lng, lat } = proj.toGeo(point.x, point.y);
      return { lat, lng };
    });
    return { proj, origin, bounds, localPath, geoPath };
  } catch {
    // Degenerate / self-intersecting obstacle geometry can make turf throw;
    // degrade to an empty path instead of crashing the planning page.
    return { proj, origin, bounds, localPath: [], geoPath: [] };
  }
}
