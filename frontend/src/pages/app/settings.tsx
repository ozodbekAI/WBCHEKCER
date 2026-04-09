import SettingsModule from "@/components/modules/settings-module"
import { useShopId } from "@/components/shop-context"

export default function SettingsPage() {
  const shopId = useShopId()
  return <SettingsModule shopId={shopId} />
}
