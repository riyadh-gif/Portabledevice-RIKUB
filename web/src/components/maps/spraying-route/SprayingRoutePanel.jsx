import { Layers, X } from "lucide-react";

function Stat({ label, value, tone = "text-forest" }) {
  return (
    <div className="rounded-xl border border-emerald-950/10 bg-emerald-50 px-2 py-1.5">
      <div className={`text-[8px] font-black uppercase tracking-[0.1em] ${tone}`}>
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
        {value}
      </div>
    </div>
  );
}

function NumberInput({ label, value, min, step, unit, onChange }) {
  return (
    <label className="block">
      <span className="block text-[8px] font-black uppercase tracking-[0.1em] text-gray-400">
        {label}
      </span>
      <div className="mt-0.5 flex h-9 items-center rounded-xl border border-gray-200 bg-gray-50 px-2 focus-within:border-forest">
        <input
          type="number"
          min={min}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent text-center text-[14px] font-black tabular-nums text-gray-900 outline-none"
        />
        <span className="text-[10px] font-bold text-gray-400">{unit}</span>
      </div>
    </label>
  );
}

export function SprayingRoutePanel({
  panelSwitch,
  targetCount,
  waypointCount,
  readyCount,
  altitude,
  speed,
  onAltitudeChange,
  onSpeedChange,
  onClose,
  onOpenTargets,
}) {
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col border-t border-gray-100 pt-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black leading-tight text-gray-950">
            Misi Penyemprotan
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
            Rute, waypoint, dan status drone
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {panelSwitch}
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
            title="Tutup Spraying Route"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {targetCount === 0 ? (
        <div className="overflow-hidden rounded-2xl border border-dashed border-emerald-200 bg-gradient-to-br from-emerald-50 to-cream">
          <div className="px-4 pb-5 pt-4 text-center">
            <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-white text-forest shadow-sm ring-1 ring-emerald-100">
              <Layers className="h-5 w-5" />
            </div>
            <div className="text-[13px] font-black text-emerald-950">
              Belum ada target semprot
            </div>
            <p className="mx-auto mt-1 max-w-[310px] text-xs font-semibold leading-snug text-emerald-800">
              Aktifkan Spray Targets atau approve NDVI Zones terlebih dahulu sebelum membuat rute.
            </p>
            <button
              type="button"
              onClick={onOpenTargets}
              className="mt-4 inline-flex h-9 items-center justify-center rounded-xl bg-forest px-4 text-[11px] font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.18)] transition-colors hover:bg-house"
            >
              Buka Spray Targets
            </button>
          </div>
          <div className="grid grid-cols-3 border-t border-emerald-100 bg-white/70 text-center text-[9px] font-black uppercase tracking-[0.08em] text-emerald-800">
            <div className="px-2 py-2">Targets</div>
            <div className="border-x border-emerald-100 px-2 py-2">Route</div>
            <div className="px-2 py-2">Mission</div>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Target" value={targetCount} />
            <Stat label="Waypoint" value={waypointCount} />
            <Stat
              label="Ready"
              value={`${readyCount}/${targetCount}`}
              tone="text-emerald-700"
            />
          </div>

          <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2.5">
            <div className="mb-2 text-[10px] font-black uppercase tracking-[0.12em] text-gray-500">
              Flight Settings
            </div>
            <div className="grid grid-cols-2 gap-2">
              <NumberInput
                label="Altitude"
                min="1"
                step="0.5"
                value={altitude}
                unit="m"
                onChange={(value) => onAltitudeChange(Math.max(1, value || 1))}
              />
              <NumberInput
                label="Speed"
                min="0.5"
                step="0.5"
                value={speed}
                unit="m/s"
                onChange={(value) => onSpeedChange(Math.max(0.5, value || 0.5))}
              />
            </div>
          </div>

          <div className="mt-2 grid gap-2">
            <button
              type="button"
              className="flex h-10 items-center justify-center rounded-xl bg-forest px-4 text-[12px] font-black text-white shadow-[0_10px_20px_rgba(0,98,65,0.18)] transition-colors hover:bg-house"
            >
              Generate Route
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled
                className="flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-3 text-[11px] font-black text-gray-400"
                title="Belum terhubung ke backend drone"
              >
                Upload Mission
              </button>
              <button
                type="button"
                disabled
                className="flex h-9 items-center justify-center rounded-xl border border-gray-200 bg-gray-100 px-3 text-[11px] font-black text-gray-400"
                title="Belum terhubung ke backend drone"
              >
                Execute
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
