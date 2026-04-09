import FeedbacksModule from "@/components/modules/feedbacks-module"
import { useShopId } from "@/components/shop-context"

export default function FeedbacksPage() {
  const shopId = useShopId()
  return (
    <div className="-mx-4 -my-4 lg:-mx-5 lg:-my-5 3xl:-mx-7 3xl:-my-6 4xl:-mx-8 4xl:-my-6 h-[calc(100vh-3.5rem)] 3xl:h-[calc(100vh-4rem)] 4xl:h-[calc(100vh-4.25rem)] overflow-hidden">
      <div className="h-full px-3 pt-3 lg:px-4 lg:pt-3 3xl:px-5 3xl:pt-4">
        <FeedbacksModule shopId={shopId} />
      </div>
    </div>
  )
}
