import { useEffect } from "react"
import { useNavigate } from "react-router-dom"

export default function DraftsPage() {
  const navigate = useNavigate()

  useEffect(() => {
    navigate("/app/feedbacks?section=drafts", { replace: true })
  }, [navigate])

  return null
}
