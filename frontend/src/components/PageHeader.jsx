import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PageHeader({ title, Icon, accent = 'text-forest', onBack, children }) {
  return (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <Button variant="outline" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" /> Menu
      </Button>
      {children}
      <div className="flex items-center gap-2">
        {Icon && <Icon className={`h-5 w-5 ${accent}`} strokeWidth={1.9} />}
        <span className="text-lg font-bold tracking-tight text-foreground">{title}</span>
      </div>
    </header>
  );
}
