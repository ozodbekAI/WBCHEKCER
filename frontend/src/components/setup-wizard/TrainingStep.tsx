import { useState } from "react";
import { Brain, Upload, Plus, ChevronDown, Pencil, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface TrainingExample {
  id: string;
  text: string;
  source: string;
  createdAt: Date;
}

interface TrainingStepProps {
  examples: string[];
  onAddExample: (example: string) => void;
}

interface CategoryConfig {
  key: string;
  title: string;
  subtitle: string;
  stars: number[];
  colorClasses: {
    bg: string;
    border: string;
    icon: string;
    text: string;
    button: string;
  };
}

const categories: CategoryConfig[] = [
  {
    key: "positive",
    title: "Положительные отзывы",
    subtitle: "Ответы на отзывы с высокой оценкой",
    stars: [4, 5],
    colorClasses: {
      bg: "bg-success/5",
      border: "border-success/30",
      icon: "text-success",
      text: "text-success",
      button: "border-success/50 text-success hover:bg-success/10",
    },
  },
  {
    key: "neutral",
    title: "Нейтральные отзывы",
    subtitle: "Ответы на отзывы со средней оценкой",
    stars: [3],
    colorClasses: {
      bg: "bg-warning/5",
      border: "border-warning/30",
      icon: "text-warning",
      text: "text-warning",
      button: "border-warning/50 text-warning hover:bg-warning/10",
    },
  },
  {
    key: "negative",
    title: "Негативные отзывы",
    subtitle: "Ответы на отзывы с низкой оценкой",
    stars: [1, 2],
    colorClasses: {
      bg: "bg-destructive/5",
      border: "border-destructive/30",
      icon: "text-destructive",
      text: "text-destructive",
      button: "border-destructive/50 text-destructive hover:bg-destructive/10",
    },
  },
];

function StarRating({ count }: { count: number[] }) {
  const display = count.length === 1 
    ? `${count[0]} ★` 
    : `${count[0]}-${count[count.length - 1]} ★`;
  
  return (
    <span className="text-xs font-medium text-muted-foreground">
      {display}
    </span>
  );
}

interface TrainingCategoryCardProps {
  category: CategoryConfig;
  examples: TrainingExample[];
  onDelete: (id: string) => void;
}

function TrainingCategoryCard({ 
  category, 
  examples, 
  onDelete
}: TrainingCategoryCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const hasExamples = examples.length > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card
        className={cn(
          "border-2 transition-colors overflow-hidden",
          hasExamples ? "border-solid" : "border-dashed",
          category.colorClasses.bg,
          category.colorClasses.border
        )}
      >
        {/* Header - always visible */}
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div
                className={cn(
                  "flex items-center justify-center w-12 h-12 rounded-lg bg-background border",
                  category.colorClasses.border
                )}
              >
                <Upload className={cn("h-5 w-5", category.colorClasses.icon)} />
              </div>
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <h4 className="font-semibold">{category.title}</h4>
                  <StarRating count={category.stars} />
                </div>
                <p className="text-sm text-muted-foreground">
                  {category.subtitle}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className={cn("text-2xl font-bold", category.colorClasses.text)}>
                {examples.length}
              </span>
              
              {hasExamples && (
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                  >
                    <ChevronDown 
                      className={cn(
                        "h-4 w-4 transition-transform",
                        isOpen && "rotate-180"
                      )} 
                    />
                  </Button>
                </CollapsibleTrigger>
              )}
              
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button
                      variant="outline"
                      size="sm"
                      className={cn("", category.colorClasses.button)}
                      disabled
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Загрузить
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Скоро будет доступно</TooltipContent>
              </Tooltip>
            </div>
          </div>
        </CardContent>

        {/* Expandable content with examples */}
        <CollapsibleContent>
          <div className="border-t border-border/50 bg-background/50">
            <div className="divide-y divide-border/50">
              {examples.map((example) => (
                <div 
                  key={example.id} 
                  className="p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm line-clamp-2">{example.text}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Источник: {example.source === "manual" ? "Ручной ввод" : example.source}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span tabIndex={0}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            disabled
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Скоро будет доступно</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(example.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export function TrainingStep({ examples, onAddExample }: TrainingStepProps) {
  // В мастере пока пустые примеры - демо-данные только в настройках
  const [categoryExamples, setCategoryExamples] = useState<Record<string, TrainingExample[]>>({
    positive: [],
    neutral: [],
    negative: [],
  });

  const handleDelete = (categoryKey: string, id: string) => {
    setCategoryExamples(prev => ({
      ...prev,
      [categoryKey]: prev[categoryKey].filter(ex => ex.id !== id),
    }));
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Обучение ИИ</h2>
        <p className="text-muted-foreground">
          Загрузите примеры ваших лучших ответов для каждой категории
        </p>
      </div>

      {/* Категории с зонами загрузки */}
      <div className="space-y-4">
        {categories.map((category) => (
          <TrainingCategoryCard
            key={category.key}
            category={category}
            examples={categoryExamples[category.key] || []}
            onDelete={(id) => handleDelete(category.key, id)}
          />
        ))}
      </div>

      {/* Форматы файлов */}
      <p className="text-xs text-center text-muted-foreground">
        Поддерживаемые форматы: .txt, .csv, .xlsx
      </p>

      {/* Подсказка */}
      <div className="flex items-start gap-3 p-4 rounded-lg bg-muted/50">
        <Brain className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h4 className="font-medium text-sm mb-1">Зачем это нужно?</h4>
          <p className="text-sm text-muted-foreground">
            Примеры помогают ИИ лучше понять ваш стиль общения и создавать 
            более подходящие ответы. Этот шаг можно пропустить и добавить примеры позже в настройках.
          </p>
        </div>
      </div>
    </div>
  );
}
