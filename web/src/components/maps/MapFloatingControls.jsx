import { LocateFixed, Loader2, Minus, Plus } from "lucide-react";

export function MapFloatingControls({
  locating,
  onLocate,
  onZoomIn,
  onZoomOut,
}) {
  return (
    <>
      <div className="absolute right-4 top-[82px] z-[1000] overflow-hidden rounded-[16px] bg-white shadow-[0_8px_30px_rgba(0,0,0,0.12)] sm:top-4">
        <button
          onClick={onZoomIn}
          className="grid h-12 w-12 place-items-center text-forest transition-colors hover:bg-gray-50"
          title="Perbesar peta"
        >
          <Plus className="h-5 w-5" />
        </button>
        <div className="h-px bg-gray-100" />
        <button
          onClick={onZoomOut}
          className="grid h-12 w-12 place-items-center text-forest transition-colors hover:bg-gray-50"
          title="Perkecil peta"
        >
          <Minus className="h-5 w-5" />
        </button>
      </div>

      <button
        onClick={onLocate}
        disabled={locating}
        className="absolute bottom-6 right-4 z-[1000] grid h-12 w-12 place-items-center rounded-[16px] bg-white text-forest shadow-[0_8px_30px_rgba(0,0,0,0.12)] transition-colors hover:bg-gray-50 disabled:text-gray-400"
        title="Lokasi saya"
      >
        {locating ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <LocateFixed className="h-5 w-5" />
        )}
      </button>
    </>
  );
}
