import QuestionsModule from "@/components/modules/questions-module"
import { useShopId } from "@/components/shop-context"

export default function QuestionsPage() {
  const shopId = useShopId()
  return <QuestionsModule shopId={shopId} />
}
