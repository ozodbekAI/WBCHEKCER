import type React from "react";
import { Zap, Eye, Hand, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { AutomationMode } from "./types";

interface ModeStepProps {
  selectedMode: AutomationMode | null;
  onSelectMode: (mode: AutomationMode) => void;
}

const modes: Record<AutomationMode, {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  recommended?: boolean;
  safeForFirstRun?: boolean;
}> = {
  autopilot: {
    icon: <Zap className="h-6 w-6" />,
    title: "Автопилот",
    description: "ИИ отвечает и публикует автоматически",
    features: [
      "Авто-ответы на все отзывы",
      "Мгновенная публикация",
      "Минимум вашего времени",
    ],
  },
  control: {
    icon: <Eye className="h-6 w-6" />,
    title: "Контроль",
    description: "ИИ создаёт черновики, вы проверяете",
    features: [
      "Черновики для всех отзывов",
      "Публикация после проверки",
      "Полный контроль качества",
    ],
    recommended: true,
    safeForFirstRun: true,
  },
  manual: {
    icon: <Hand className="h-6 w-6" />,
    title: "Ручной режим",
    description: "Только просмотр и аналитика",
    features: [
      "Сбор отзывов со всех площадок",
      "Статистика и аналитика",
      "Генерация по запросу",
    ],
  },
};

export function ModeStep({ selectedMode, onSelectMode }: ModeStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Как должна работать система?</h2>
        <p className="text-muted-foreground">
          Выберите степень автоматизации для ответов на отзывы
        </p>
      </div>

      <div className="grid gap-4">
        {(Object.keys(modes) as AutomationMode[]).map((key) => {
          const mode = modes[key];
          const isSelected = selectedMode === key;

          return (
            <div
              key={key}
              onClick={() => onSelectMode(key)}
              className={cn(
                "relative rounded-xl p-5 cursor-pointer border-2 transition-all",
                isSelected
                  ? "border-primary bg-primary/5"
                  : "border-transparent bg-muted/30 hover:bg-muted/50"
              )}
            >
              {mode.recommended && (
                <div className="absolute -top-2 left-4 flex items-center gap-2">
                  <span className="px-2 py-0.5 text-xs font-medium bg-primary text-primary-foreground rounded-full">
                    Рекомендуем
                  </span>
                  {mode.safeForFirstRun && (
                    <span className="px-2 py-0.5 text-xs font-medium bg-success text-success-foreground rounded-full">
                      Безопасно для первого запуска
                    </span>
                  )}
                </div>
              )}

              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    "p-3 rounded-lg",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {mode.icon}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-lg">{mode.title}</h3>
                    {isSelected && <Check className="h-5 w-5 text-primary" />}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {mode.description}
                  </p>
                  <ul className="space-y-1">
                    {mode.features.map((feature, i) => (
                      <li key={i} className="text-sm flex items-center gap-2">
                        <span className="text-primary">✓</span>
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
