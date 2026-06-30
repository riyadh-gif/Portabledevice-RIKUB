import { ChevronLeft, ChevronRight } from "lucide-react";

function TelemetrySection({ title, rows }) {
  return (
    <div className="rounded-2xl border border-emerald-300/16 bg-gradient-to-br from-house/92 to-slate-950/82 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="mb-1.5 flex items-center gap-1.5 text-[8px] font-black uppercase tracking-[0.14em] text-emerald-300">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-300/80" />
        {title}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 [&>span]:flex [&>span]:justify-between [&>span]:gap-2 [&>span>span]:text-slate-400">
        {rows.map(([label, value]) => (
          <span key={label}>
            <span className="text-slate-400">{label}</span> {value}
          </span>
        ))}
      </div>
    </div>
  );
}

const TELEMETRY_SECTIONS = [
  {
    title: "Flight State",
    rows: [
      ["Connected", "No Link"],
      ["Armed", "Disarmed"],
      ["Guided", "No"],
      ["Manual", "-"],
      ["Mode", "-"],
      ["System", "-"],
    ],
  },
  {
    title: "GPS",
    rows: [
      ["Fix", "No Fix"],
      ["Sat", "-"],
      ["Lat", "-"],
      ["Lon", "-"],
      ["Speed", "-"],
      ["Course", "-"],
      ["EPH", "-"],
      ["EPV", "-"],
      ["Alt MSL", "-"],
    ],
  },
  {
    title: "Global Position",
    rows: [
      ["Lat", "-"],
      ["Lon", "-"],
      ["Alt Ellip", "-"],
      ["Source", "-"],
    ],
  },
  {
    title: "IMU",
    rows: [
      ["Accel X", "-"],
      ["Accel Y", "-"],
      ["Accel Z", "-"],
      ["Gyro X", "-"],
      ["Gyro Y", "-"],
      ["Gyro Z", "-"],
      ["Quat X", "-"],
      ["Quat Y", "-"],
      ["Quat Z", "-"],
      ["Quat W", "-"],
    ],
  },
];

export function DroneTelemetryBar({ collapsed, onToggle }) {
  return (
    <div className="absolute bottom-6 left-4 right-20 z-[1000] flex justify-end lg:left-auto lg:max-w-[calc(100vw-8rem)]">
      <div className="max-w-full rounded-[22px] border border-emerald-300/14 bg-house/92 px-3 py-2 text-white shadow-[0_18px_48px_rgba(2,6,23,0.42)] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-slate-400 ring-4 ring-slate-400/15" />
            <span className="truncate text-[10px] font-black uppercase tracking-[0.14em] text-slate-100">
              Drone Offline
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {!collapsed && (
              <span className="rounded-full bg-slate-800/90 px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-slate-100 ring-1 ring-emerald-200/10">
                Mission Idle
              </span>
            )}
            <button
              type="button"
              onClick={onToggle}
              className="grid h-6 w-6 place-items-center rounded-full bg-white/10 text-slate-100 ring-1 ring-emerald-200/10 transition hover:bg-white/20"
              aria-label={collapsed ? "Expand telemetry" : "Collapse telemetry"}
              title={collapsed ? "Expand telemetry" : "Collapse telemetry"}
            >
              {collapsed ? (
                <ChevronLeft className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        </div>
        {!collapsed && (
          <div className="mt-2 grid max-h-[34dvh] gap-2 overflow-y-auto overscroll-contain pr-1 text-[10px] font-bold tabular-nums text-slate-50 sm:grid-cols-2 xl:grid-cols-4">
            {TELEMETRY_SECTIONS.map((section) => (
              <TelemetrySection key={section.title} {...section} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
