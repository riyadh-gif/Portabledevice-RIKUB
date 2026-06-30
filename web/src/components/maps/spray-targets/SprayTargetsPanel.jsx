import { Loader2, MapPin } from "lucide-react";

function Stat({ label, value, tone = "rose" }) {
  const colors =
    tone === "emerald"
      ? "border-emerald-950/10 bg-emerald-50 text-emerald-700"
      : "border-rose-950/10 bg-rose-50 text-rose-700";

  return (
    <div className={`rounded-xl border px-2 py-1.5 ${colors}`}>
      <div className="text-[8px] font-black uppercase tracking-[0.1em]">
        {label}
      </div>
      <div className="mt-0.5 text-[13px] font-black tabular-nums text-gray-950">
        {value}
      </div>
    </div>
  );
}

export function SprayTargetsPanel({
  panelSwitch,
  loading,
  error,
  features,
  totalAreaM2,
  readyCount,
  formatNumber,
  onFocusTarget,
}) {
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black leading-tight text-gray-950">
            Spray Targets
          </div>
          <div className="mt-0.5 text-[10px] font-semibold text-gray-500">
            Polygon final dari database
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-rose-600" />}
          {panelSwitch}
        </div>
      </div>
      {error && (
        <div className="mt-2 rounded-2xl bg-red-50 px-3 py-2 text-xs font-semibold text-red-600">
          {error}
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat label="Target" value={features.length} />
        <Stat label="Area" value={formatNumber(totalAreaM2)} />
        <Stat label="Ready" value={readyCount} tone="emerald" />
      </div>
      {features.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="grid grid-cols-[58px_minmax(0,1fr)_92px_54px] items-center justify-items-center gap-2 border-b border-gray-100 bg-gray-50 px-2.5 py-2">
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Zona
            </span>
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Area
            </span>
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Chamber
            </span>
            <span className="text-center text-[9px] font-black uppercase tracking-[0.12em] text-gray-500">
              Aksi
            </span>
          </div>
          <div className="max-h-52 overflow-y-auto">
            {features.map((feature, index) => {
              const props = feature.properties ?? {};
              const targetId = props.id ?? props.zone_code ?? index;
              return (
                <div
                  key={targetId}
                  className="grid w-full grid-cols-[58px_minmax(0,1fr)_92px_54px] items-center justify-items-center gap-2 border-b border-gray-100 px-2.5 py-2 last:border-b-0"
                >
                  <span className="text-center text-[12px] font-black text-gray-950">
                    {props.zone_code ?? `Z${String(index + 1).padStart(2, "0")}`}
                  </span>
                  <span className="min-w-0 truncate text-center text-[11px] font-black tabular-nums text-gray-700">
                    {formatNumber(props.area_m2)} m2
                  </span>
                  <span
                    className={`inline-flex h-7 w-full max-w-[92px] items-center justify-center rounded-full border px-2 text-center text-[10px] font-black ${
                      props.chamber && props.chamber !== "none"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                        : "border-gray-200 bg-gray-50 text-gray-400"
                    }`}
                  >
                    {props.chamber ?? "none"}
                  </span>
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      onClick={() => onFocusTarget(targetId)}
                      className="grid h-8 w-9 place-items-center rounded-xl border border-rose-200 bg-white text-rose-700 shadow-sm transition-colors hover:bg-rose-50"
                      title="Lihat di peta"
                    >
                      <MapPin className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
