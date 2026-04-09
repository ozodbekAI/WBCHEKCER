import Landing from "@/components/marketing/landing"
import { isRegistrationOpen } from "@/lib/auth-entry"

export default function HomePage() {
  return <Landing registrationOpen={isRegistrationOpen()} />
}
