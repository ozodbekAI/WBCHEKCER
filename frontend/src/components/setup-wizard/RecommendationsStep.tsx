import { Package, Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface RecommendationsStepProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function RecommendationsStep({ enabled, onToggle }: RecommendationsStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Рекомендации товаров</h2>
        <p className="text-muted-foreground">
          Включить автоматические рекомендации в ответах?
        </p>
      </div>

      <div
        onClick={() => onToggle(!enabled)}
        className={cn(
          "relative rounded-xl p-6 cursor-pointer border-2 transition-all",
          enabled
            ? "border-primary bg-primary/5"
            : "border-muted bg-muted/20"
        )}
      >
        <div className="flex items-start gap-4">
          <div
            className={cn(
              "p-3 rounded-lg",
              enabled
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Package className="h-6 w-6" />
          </div>

          <div className="flex-1">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-lg">
                {enabled ? "Рекомендации включены" : "Рекомендации выключены"}
              </h3>
              <Switch checked={enabled} onCheckedChange={onToggle} />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              ИИ будет добавлять релевантные ссылки на товары в ответы на отзывы
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 text-sm">
                {enabled ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={cn(!enabled && "text-muted-foreground")}>
                  Кросс-продажи
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {enabled ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={cn(!enabled && "text-muted-foreground")}>
                  Апсейл похожих товаров
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {enabled ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={cn(!enabled && "text-muted-foreground")}>
                  Персонализация по истории
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                {enabled ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <X className="h-4 w-4 text-muted-foreground" />
                )}
                <span className={cn(!enabled && "text-muted-foreground")}>
                  Увеличение среднего чека
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="text-sm text-center text-muted-foreground">
        Этот шаг можно пропустить и настроить позже
      </p>
    </div>
  );
}
