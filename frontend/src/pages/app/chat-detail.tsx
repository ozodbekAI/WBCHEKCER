import { useParams } from "react-router-dom"

import ChatThreadModule from "@/components/modules/chat-thread-module"
import { useShopId } from "@/components/shop-context"

export default function ChatThreadPage() {
  const shopId = useShopId()
  const params = useParams<{ chat_id: string }>()
  const chatId = params?.chat_id

  if (!shopId || !chatId) return null
  return <ChatThreadModule shopId={shopId} chatId={chatId} />
}
