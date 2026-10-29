"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { JobDetail } from "@/components/JobDetail";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  return (
    <AppShell>
      <JobDetail jobId={params?.id ?? ""} />
    </AppShell>
  );
}
