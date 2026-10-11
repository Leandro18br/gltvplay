import { createFileRoute } from "@tanstack/react-router";
import { ResourceManager } from "@/components/admin/ResourceManager";
import { LiveChannelsButton } from "@/components/admin/integrations/LiveChannelsCard";
import { channelsConfig } from "@/lib/admin/configs";
import { adminHead } from "@/lib/admin/head";

export const Route = createFileRoute("/admin/channels")({ head: () => adminHead("Canais", "Gerencie canais e fontes autorizadas."), component: ChannelsPage });

function ChannelsPage() {
  return <div className="space-y-3"><div className="flex flex-wrap justify-end gap-2"><LiveChannelsButton /></div><ResourceManager config={channelsConfig} /></div>;
}
