import { useNavigate } from "react-router-dom"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface WelcomeModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const WelcomeModal = ({ open, onOpenChange }: WelcomeModalProps) => {
  const navigate = useNavigate()

  const handleGoToReviews = () => {
    onOpenChange(false)
    navigate("/app/feedbacks")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl">Быстрое объяснение (30 секунд)</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground">
          Я покажу, где здесь самое важное, а потом переведу вас на «Отзывы»...
        </p>

        <div className="space-y-3 mt-4">
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="font-medium">1) Проблемы</p>
            <p className="text-sm text-muted-foreground">Здесь будут подсказки, что требует внимания.</p>
          </div>

          <div className="bg-muted/30 rounded-lg p-4">
            <p className="font-medium">2) Ожидают ответа</p>
            <p className="text-sm text-muted-foreground">Отзывы без ответа. Внутри сразу открыт ввод ответа.</p>
          </div>

          <div className="bg-muted/30 rounded-lg p-4">
            <p className="font-medium">3) Автоматизация</p>
            <p className="text-sm text-muted-foreground">
              Черновики/публикация работают по настройкам, которые вы только что задали.
            </p>
          </div>
        </div>

        <div className="flex justify-end mt-4">
          <Button onClick={handleGoToReviews}>Перейти к отзывам</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default WelcomeModal
