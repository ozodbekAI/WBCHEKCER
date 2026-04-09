import { useParams } from "react-router-dom"
import TeamInvitePage from "@/components/auth/team-invite-page"

export default function InvitePage() {
  const { token } = useParams<{ token: string }>()
  return <TeamInvitePage token={token || ""} />
}
