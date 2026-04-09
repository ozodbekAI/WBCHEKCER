import RegisterForm from "@/components/auth/register-form"
import { isRegistrationOpen } from "@/lib/auth-entry"

export default function RegisterPage() {
  return <RegisterForm registrationOpen={isRegistrationOpen()} />
}
