import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";

interface ResponseStyleConfig {
  addressForm: 'formal-you' | 'informal-you' | 'ty';
  useCustomerName: boolean;
  useEmoji: boolean;
  responseLength: 'short' | 'default' | 'long';
}

interface ResponseStyleStepProps {
  config: ResponseStyleConfig;
  onUpdate: (config: Partial<ResponseStyleConfig>) => void;
}

export function ResponseStyleStep({ config, onUpdate }: ResponseStyleStepProps) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold mb-2">Стиль ответов</h2>
        <p className="text-muted-foreground">
          Настройте как ИИ будет формулировать ответы
        </p>
      </div>

      {/* Формат обращения */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Формат обращения</Label>
        <RadioGroup 
          value={config.addressForm} 
          onValueChange={(value) => onUpdate({ addressForm: value as ResponseStyleConfig['addressForm'] })}
          className="grid grid-cols-3 gap-3"
        >
          {[
            { value: 'formal-you', label: 'На «Вы»', example: 'Благодарим Вас за отзыв' },
            { value: 'informal-you', label: 'На «вы»', example: 'Благодарим вас за отзыв' },
            { value: 'ty', label: 'На «ты»', example: 'Спасибо тебе за отзыв' },
          ].map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex flex-col items-center p-4 rounded-xl border-2 cursor-pointer transition-all text-center",
                config.addressForm === option.value
                  ? "border-primary bg-primary/5"
                  : "border-transparent bg-muted/30 hover:bg-muted/50"
              )}
            >
              <RadioGroupItem value={option.value} className="sr-only" />
              <span className="font-medium mb-1">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.example}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Длина ответа */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Длина ответов</Label>
        <RadioGroup 
          value={config.responseLength} 
          onValueChange={(value) => onUpdate({ responseLength: value as ResponseStyleConfig['responseLength'] })}
          className="grid grid-cols-3 gap-3"
        >
          {[
            { value: 'short', label: 'Краткий', desc: '1-2 предложения' },
            { value: 'default', label: 'Стандартный', desc: '2-4 предложения' },
            { value: 'long', label: 'Развёрнутый', desc: '4-6 предложений' },
          ].map((option) => (
            <label
              key={option.value}
              className={cn(
                "flex flex-col items-center p-4 rounded-xl border-2 cursor-pointer transition-all text-center",
                config.responseLength === option.value
                  ? "border-primary bg-primary/5"
                  : "border-transparent bg-muted/30 hover:bg-muted/50"
              )}
            >
              <RadioGroupItem value={option.value} className="sr-only" />
              <span className="font-medium mb-1">{option.label}</span>
              <span className="text-xs text-muted-foreground">{option.desc}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {/* Переключатели */}
      <div className="space-y-3">
        <Label className="text-base font-medium">Персонализация</Label>
        
        <div className="space-y-2">
          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
            <div>
              <span className="font-medium">Обращение по имени</span>
              <p className="text-sm text-muted-foreground">
                Использовать имя покупателя в ответе
              </p>
            </div>
            <Switch 
              checked={config.useCustomerName} 
              onCheckedChange={(checked) => onUpdate({ useCustomerName: checked })}
            />
          </div>

          <div className="flex items-center justify-between p-4 bg-muted/30 rounded-xl">
            <div>
              <span className="font-medium">Эмодзи в ответах</span>
              <p className="text-sm text-muted-foreground">
                Добавлять подходящие эмодзи автоматически
              </p>
            </div>
            <Switch 
              checked={config.useEmoji} 
              onCheckedChange={(checked) => onUpdate({ useEmoji: checked })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
