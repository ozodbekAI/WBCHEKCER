import { useParams } from "react-router-dom"
import PasswordResetPage from "@/components/auth/password-reset-page"

export default function ResetPasswordRoute() {
  const { token } = useParams<{ token: string }>()
  return <PasswordResetPage token={token || ""} />
}
