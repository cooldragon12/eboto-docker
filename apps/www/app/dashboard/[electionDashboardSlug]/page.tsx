import DashboardOverview from "@/components/client/pages/dashboard-overview";
import { electionCallerFunc } from "@/server/api/routers/election";
import { notFound } from "next/navigation";

export default async function Page({
  params: { electionDashboardSlug },
}: {
  params: { electionDashboardSlug: string };
}) {
  const electionCaller = await electionCallerFunc();
  const election = await electionCaller.getElectionBySlug({
    slug: electionDashboardSlug,
  });

  if (!election) notFound();

  return <DashboardOverview election={election} />;
}
