import { useSearchParams } from "react-router-dom"
import LoginForm from "@/components/auth/login-form"
import { isRegistrationOpen } from "@/lib/auth-entry"

export default function LoginPage() {
  const [searchParams] = useSearchParams()
  const nextPath = searchParams.get("next")

  return (
    <LoginForm
      nextPath={nextPath}
      registrationOpen={isRegistrationOpen()}
    />
  )
}
