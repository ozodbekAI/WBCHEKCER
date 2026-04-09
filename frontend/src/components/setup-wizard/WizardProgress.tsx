import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { WizardStep } from "./types";

interface WizardProgressProps {
  currentStep: WizardStep;
  completedSteps: WizardStep[];
  onStepClick?: (step: WizardStep) => void;
}

const VISIBLE_STEPS: { step: WizardStep; label: string; required: boolean }[] = [
  { step: 'connection', label: 'Подключение', required: true },
  { step: 'import', label: 'Импорт', required: true },
  { step: 'mode', label: 'Режим', required: true },
  { step: 'tone', label: 'Тон', required: true },
];

export function WizardProgress({ currentStep, completedSteps, onStepClick }: WizardProgressProps) {
  const currentIndex = VISIBLE_STEPS.findIndex(s => s.step === currentStep);

  return (
    <div className="flex items-center justify-between w-full max-w-3xl mx-auto">
      {VISIBLE_STEPS.map((item, index) => {
        const isCompleted = completedSteps.includes(item.step);
        const isCurrent = item.step === currentStep;
        const isPast = index < currentIndex;
        const canClick = isCompleted || isPast;

        return (
          <div key={item.step} className="flex items-center flex-1 last:flex-none">
            {/* Step circle */}
            <button
              onClick={() => canClick && onStepClick?.(item.step)}
              disabled={!canClick}
              className={cn(
                "flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium transition-all",
                "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
                isCompleted && "bg-primary text-primary-foreground",
                isCurrent && !isCompleted && "bg-primary/20 text-primary border-2 border-primary",
                !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                canClick && "cursor-pointer hover:scale-110",
                !canClick && "cursor-default"
              )}
            >
              {isCompleted ? (
                <Check className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </button>

            {/* Step label */}
            <span
              className={cn(
                "ml-2 text-xs font-medium hidden sm:block",
                isCurrent ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {item.label}
              {!item.required && <span className="text-muted-foreground/50 ml-1">*</span>}
            </span>

            {/* Connector line */}
            {index < VISIBLE_STEPS.length - 1 && (
              <div
                className={cn(
                  "flex-1 h-0.5 mx-2",
                  isPast || isCompleted ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
