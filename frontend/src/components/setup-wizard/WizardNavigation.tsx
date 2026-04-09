import { ChevronLeft, ChevronRight, X, SkipForward } from "lucide-react";
import { Button } from "@/components/ui/button";
import { WizardStep } from "./types";

interface WizardNavigationProps {
  currentStep: WizardStep;
  canSkip: boolean;
  canGoBack: boolean;
  canProceed: boolean;
  isLastStep: boolean;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onExit: () => void;
}

export function WizardNavigation({
  currentStep,
  canSkip,
  canGoBack,
  canProceed,
  isLastStep,
  onNext,
  onPrev,
  onSkip,
  onExit,
}: WizardNavigationProps) {
  // Первый шаг нельзя пропустить и нельзя вернуться
  const isFirstStep = currentStep === 'connection';

  return (
    <div className="flex items-center justify-between pt-6 border-t">
      <div className="flex items-center gap-2">
        {/* Кнопка выхода */}
        {!isFirstStep && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onExit}
            className="text-muted-foreground"
          >
            <X className="h-4 w-4 mr-1" />
            Выйти
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* Назад */}
        {canGoBack && !isFirstStep && (
          <Button variant="outline" onClick={onPrev}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Назад
          </Button>
        )}

        {/* Пропустить */}
        {canSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Пропустить
            <SkipForward className="h-4 w-4 ml-1" />
          </Button>
        )}

        {/* Далее / Завершить */}
        <Button onClick={onNext} disabled={!canProceed}>
          {isLastStep ? (
            "Завершить настройку"
          ) : (
            <>
              Далее
              <ChevronRight className="h-4 w-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
