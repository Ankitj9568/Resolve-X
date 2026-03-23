 
export default function SandboxBanner({ demoMode }: { demoMode: boolean }) {
  if (!demoMode) return null;
  return (
    <div className="w-full bg-amber-400 text-amber-900 text-xs font-medium
                    text-center py-2 px-4 sticky top-0 z-50">
      ⚠ SANDBOX MODE — Demo environment · Complaints are illustrative
    </div>
  );
}