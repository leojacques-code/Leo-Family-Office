import { AppShell } from "@/components/app-shell";
import { DEFAULT_SECTION } from "@/lib/navigation";
import { getRepository } from "@/lib/data/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TodayPage() {
  const repository = await getRepository();
  return <AppShell initialState={await repository.getDashboardState()} section={DEFAULT_SECTION} />;
}
