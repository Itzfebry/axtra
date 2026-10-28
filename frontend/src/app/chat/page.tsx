import { AppShell } from "@/components/AppShell";
import { ChatPanel } from "@/components/ChatPanel";

export default function NewChatPage() {
  return (
    <AppShell>
      <ChatPanel conversationId={null} mode="general" />
    </AppShell>
  );
}
