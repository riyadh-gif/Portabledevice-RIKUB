import { useNavigate } from "react-router-dom";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const DASHBOARD_URL =
  import.meta.env.VITE_DRONE_DASHBOARD_URL || "http://localhost:3001/dashboard";

export function DroneDashboard() {
  const navigate = useNavigate();

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/maps")}>
          <ArrowLeft className="h-4 w-4" />
          Maps
        </Button>
        <div className="min-w-0 text-center">
          <div className="truncate text-sm font-black text-slate-900">
            Drone Dashboard
          </div>
          <div className="truncate text-[11px] font-semibold text-slate-500">
            {DASHBOARD_URL}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(DASHBOARD_URL, "_blank", "noopener,noreferrer")}
        >
          <ExternalLink className="h-4 w-4" />
          Open
        </Button>
      </div>
      <iframe
        src={DASHBOARD_URL}
        title="Drone Dashboard"
        className="min-h-0 flex-1 border-0 bg-white"
      />
    </div>
  );
}
