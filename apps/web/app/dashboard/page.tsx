import CreateElection from "@/components/client/modals/create-election";
import { db } from "@eboto-mo/db";
import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

export default async function Page() {
  const session = await getServerSession();

  if (!session) redirect("/");

  const electionsAsCommissioner = await db.query.commissioners.findMany({
    where: (commissioners, { eq }) =>
      eq(commissioners.user_id, session.user.id),
    with: {
      election: true,
    },
  });
  const electionsAsVoter = await db.query.voters.findMany({
    where: (voters, { eq }) => eq(voters.user_id, session.user.id),
    with: {
      election: true,
    },
  });
  return (
    <div>
      <CreateElection />
    </div>
  );
}
