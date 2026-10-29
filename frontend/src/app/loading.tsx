import { LoadingState } from "@/components/ui/LoadingState";

/** Route-level fallback: shown while a new page segment is loading. */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md">
        <LoadingState label="Memuat halaman..." variant="detail" rows={4} />
      </div>
    </div>
  );
}