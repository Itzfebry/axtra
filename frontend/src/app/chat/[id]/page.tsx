import { AppShell } from "@/components/AppShell";
import { ChatPanel } from "@/components/ChatPanel";
import { isChatMode } from "@/lib/chatModes";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mode = isChatMode(id) ? id : null;

  return (
    <AppShell>
      <ChatPanel conversationId={mode ? null : id} mode={mode} />
    </AppShell>
  );
}