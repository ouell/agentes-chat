import type { Channel } from "@agenteschat/client";
import { useSetChatPrefs } from "@agenteschat/client";
import { useOrg } from "@/components/org-context";

/**
 * A channel's dashboard, this fork's way (ADR 0135 §21 without its migration): each person keeps their own board
 * beside each channel in `chatPrefs.channelBoards`, so anyone may change theirs. Same shape as upstream's hook.
 */
export function useChannelDashboard(channel: Channel) {
  const { org } = useOrg();
  const save = useSetChatPrefs(org.id);
  const boards = org.chatPrefs?.channelBoards ?? {};
  const set = {
    isPending: save.isPending,
    mutate: (dashboardId: string | null, options?: { onSuccess?: () => void; onError?: (error: unknown) => void }) => {
      const { [channel.id]: _, ...rest } = boards;
      save.mutate({ channelBoards: dashboardId ? { ...rest, [channel.id]: dashboardId } : rest }, options);
    },
  };
  return { dashboardId: boards[channel.id] ?? null, manages: !org.deletion, set };
}
