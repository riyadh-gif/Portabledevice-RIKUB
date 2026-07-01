import { droneAddrHeaders } from "@/lib/gcs/drone-settings";

async function jsonOrThrow(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error || data?.detail || `request failed (${response.status})`);
  }
  return data;
}

export async function fetchDiagnostics() {
  return jsonOrThrow(
    await fetch("/api/drone/diagnostics", {
      cache: "no-store",
      headers: droneAddrHeaders(),
    }),
  );
}

export async function fetchDroneConfig() {
  return jsonOrThrow(await fetch("/api/drone/config", { cache: "no-store" }));
}

export async function fetchJobs() {
  return jsonOrThrow(await fetch("/api/jobs", { cache: "no-store" }));
}

export async function fetchJob(id) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}`, { cache: "no-store" }));
}

export async function createJobFromFolder(sourceDir, opts = {}) {
  const name = opts.name ?? sourceDir.split("/").filter(Boolean).pop();
  return jsonOrThrow(await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source_dir: sourceDir, name, area_name: opts.areaName, image_glob: opts.imageGlob, options: opts.options }),
  }));
}

export async function cancelJob(id) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }));
}

export async function removeJob(id) {
  return jsonOrThrow(await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }));
}

async function postCommand(path, body = {}) {
  return jsonOrThrow(
    await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify(body),
    }),
  );
}

export const armDrone = (options = {}) => postCommand("/api/drone/arm", options);
export const disarmDrone = (options = {}) => postCommand("/api/drone/disarm", options);
export const takeoffDrone = (options = {}) => postCommand("/api/drone/takeoff", options);
export const landDrone = (options = {}) => postCommand("/api/drone/land", options);
export const setDroneMode = (mode, options = {}) =>
  postCommand("/api/drone/setmode", { mode, ...options });

export async function fetchDroneStatus() {
  return jsonOrThrow(
    await fetch("/api/drone/status", { cache: "no-store", headers: droneAddrHeaders() }),
  );
}

export async function gotoPoint(p) {
  return postCommand("/api/drone/goto", {
    x: p.x,
    y: p.y,
    z: p.z,
    tolerance: p.tolerance,
    hold_duration: p.holdDuration,
    method: p.method,
    max_speed: p.maxSpeed,
  });
}

export async function pushMission(p) {
  return jsonOrThrow(
    await fetch("/api/drone/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        waypoints: p.waypoints,
        geo_waypoints: p.geoWaypoints,
        altitude: p.altitude,
        speed: p.speed,
        hold_time: p.holdTime,
        acceptance_radius: p.acceptanceRadius,
      }),
    }),
  );
}

export async function executeMission(p = {}) {
  return jsonOrThrow(
    await fetch("/api/drone/mission/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...droneAddrHeaders() },
      body: JSON.stringify({
        mode: p.mode,
        altitude: p.altitude,
        job_id: p.jobId,
        session_id: p.jobId,
      }),
    }),
  );
}
