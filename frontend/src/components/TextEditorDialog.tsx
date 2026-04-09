import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Copy, Check, RefreshCw, Sparkles, Trash2 } from 'lucide-react';

interface TextEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fieldLabel: string;
  currentValue: string;
  suggestedValue: string;
  keywords?: string[];
  forceRichLayout?: boolean;
  suggestionActionLabel?: string;
  keywordsLoading?: boolean;
  onGenerate?: (options: { instructions?: string }) => Promise<{ value: string }>;
  onApply: (newValue: string) => void;
}

/** Escape regex special chars */
function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a single combined regex from keywords (longest first for greedy match) */
function buildKeywordRegex(keywords: string[]): RegExp | null {
  if (!keywords.length) return null;
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  const pattern = sorted.map(escapeRegex).join('|');
  return new RegExp(`(${pattern})`, 'gi');
}

/** Count keyword occurrences in text (case-insensitive) */
function countKeywordUsages(text: string, keywords: string[]): Map<string, number> {
  const map = new Map<string, number>();
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    const kwLower = kw.toLowerCase();
    let count = 0;
    let idx = 0;
    while ((idx = lower.indexOf(kwLower, idx)) !== -1) {
      count++;
      idx += kwLower.length;
    }
    map.set(kw, count);
  }
  return map;
}

/** Render text with highlighted keywords */
function HighlightedText({
  text,
  regex,
}: {
  text: string;
  regex: RegExp | null;
}) {
  if (!regex || !text) {
    return <span className="whitespace-pre-wrap break-words">{text || '—'}</span>;
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  // Reset regex state
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <mark
        key={match.index}
        className="bg-primary/20 text-foreground rounded-sm px-0.5"
      >
        {match[0]}
      </mark>
    );
    lastIndex = regex.lastIndex;
    if (match[0].length === 0) {
      regex.lastIndex++;
    }
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <span className="whitespace-pre-wrap break-words">{parts}</span>;
}

export default function TextEditorDialog({
  open,
  onOpenChange,
  fieldLabel,
  currentValue,
  suggestedValue,
  keywords = [],
  forceRichLayout = false,
  suggestionActionLabel = 'Вставить рекомендацию',
  keywordsLoading = false,
  onGenerate,
  onApply,
}: TextEditorDialogProps) {
  const [newValue, setNewValue] = useState(suggestedValue);
  const [generatePopoverOpen, setGeneratePopoverOpen] = useState(false);
  const [generateWithInstructions, setGenerateWithInstructions] = useState(false);
  const [generateInstructions, setGenerateInstructions] = useState('');
  const [generating, setGenerating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Reset when dialog opens
  useEffect(() => {
    if (open) {
      setNewValue(suggestedValue);
      setGeneratePopoverOpen(false);
      setGenerateWithInstructions(false);
      setGenerateInstructions('');
    }
  }, [open, suggestedValue]);

  // Sync scroll between textarea and overlay
  const handleScroll = useCallback(() => {
    const ta = textareaRef.current;
    const overlay = overlayRef.current;
    if (ta && overlay) {
      overlay.scrollTop = ta.scrollTop;
    }
  }, []);

  const keywordRegex = useMemo(() => buildKeywordRegex(keywords), [keywords]);

  const newUsages = useMemo(
    () => countKeywordUsages(newValue, keywords),
    [newValue, keywords]
  );

  const usedKeywords = useMemo(() => {
    return keywords.filter((kw) => (newUsages.get(kw) || 0) > 0);
  }, [keywords, newUsages]);

  const handleApply = useCallback(() => {
    onApply(newValue);
    onOpenChange(false);
  }, [newValue, onApply, onOpenChange]);

  const handleInsertCurrent = useCallback(() => {
    setNewValue(currentValue);
  }, [currentValue]);

  const appendInstructionKeyword = useCallback((keyword: string) => {
    setGenerateInstructions((prev) => {
      const normalized = keyword.trim();
      if (!normalized) return prev;
      if (!prev.trim()) return normalized;
      if (prev.toLowerCase().includes(normalized.toLowerCase())) return prev;
      return `${prev.trim()} ${normalized}`;
    });
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!onGenerate || generating) return;
    setGenerating(true);
    try {
      const result = await onGenerate({
        instructions: generateWithInstructions ? generateInstructions.trim() : undefined,
      });
      setNewValue(result.value);
      setGeneratePopoverOpen(false);
    } catch {
      // Parent handler surfaces the actual error message.
    } finally {
      setGenerating(false);
    }
  }, [onGenerate, generating, generateWithInstructions, generateInstructions]);

  const isRichLayout = forceRichLayout || keywords.length > 0;
  const maxLen = isRichLayout ? 2000 : 120;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`!flex flex-col p-0 gap-0 overflow-hidden ${
        !isRichLayout
          ? 'max-w-[95vw] w-[800px] max-h-[80vh]'
          : 'max-w-[98vw] w-[1420px] h-[95vh]'
      }`}>
        <DialogHeader className="px-5 py-3 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Редактор — {fieldLabel}
          </DialogTitle>
        </DialogHeader>

        <div className={`flex-1 flex min-h-0 overflow-hidden ${!isRichLayout ? 'flex-col' : ''}`}>
          {/* ── Text panels ── */}
          <div className={`flex-1 flex flex-col min-w-0 ${isRichLayout ? 'border-r border-border' : ''}`}>
            <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
              {/* Current value (read-only) */}
                <div className={`flex flex-col min-h-0 ${!isRichLayout ? '' : 'flex-[0_0_35%]'}`}>
                <div className="flex items-center mb-1.5 flex-shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Текущий вариант
                  </span>
                </div>
                {!isRichLayout ? (
                  <div className="rounded-md border border-border bg-muted/50 p-3 text-[13px] leading-[1.35] text-foreground/80 whitespace-pre-wrap break-words">
                    {currentValue || '—'}
                  </div>
                ) : (
                  <div className="flex-1 rounded-md border border-border bg-muted/50 p-3 text-[13px] leading-[1.35] text-foreground/80 overflow-auto whitespace-pre-wrap break-words">
                    {currentValue || '—'}
                  </div>
                )}
                <div className="flex items-center justify-end mt-1 flex-shrink-0">
                  <span className={`text-[11px] ${currentValue.length > maxLen ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    {currentValue.length}/{maxLen}
                  </span>
                </div>
              </div>

              <div className={`flex flex-col min-h-0 ${!isRichLayout ? '' : 'flex-1'}`}>
                <div className="flex items-center mb-1.5 flex-shrink-0">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Новый вариант
                  </span>
                </div>
                {/* Textarea with keyword highlight overlay */}
                <div className={`relative min-h-0 ${!isRichLayout ? '' : 'flex-1'}`}>
                  {isRichLayout && (
                    <div
                      ref={overlayRef}
                      aria-hidden="true"
                      className="absolute inset-0 px-3 py-2.5 text-[13px] leading-[1.35] rounded-md pointer-events-none overflow-hidden whitespace-pre-wrap break-words border border-transparent"
                    >
                      <HighlightedText text={newValue} regex={keywordRegex} />
                    </div>
                  )}
                  {!isRichLayout ? (
                    <input
                      value={newValue}
                      maxLength={maxLen}
                      onChange={(e) => setNewValue(e.target.value)}
                      className="w-full h-10 px-3 text-[13px] leading-[1.35] rounded-md border border-input bg-background text-foreground caret-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                      placeholder="Введите новый вариант…"
                    />
                  ) : (
                    <textarea
                      ref={textareaRef}
                      value={newValue}
                      maxLength={maxLen}
                      onChange={(e) => setNewValue(e.target.value)}
                      onScroll={handleScroll}
                      className="w-full h-full px-3 py-2.5 text-[13px] leading-[1.35] rounded-md border border-input bg-transparent text-transparent caret-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none relative z-10"
                      placeholder="Введите новый вариант текста…"
                    />
                  )}
                </div>
                <div className="flex items-center justify-between mt-1.5 flex-shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleInsertCurrent}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Copy className="h-3 w-3" /> Вставить текущий WB
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setNewValue('')}
                      className="h-7 text-xs gap-1.5"
                    >
                      <Trash2 className="h-3 w-3" /> Очистить
                    </Button>

                    <div className="w-px h-5 bg-border mx-1" />

                    {onGenerate ? (
                      <Popover open={generatePopoverOpen} onOpenChange={setGeneratePopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs gap-1.5"
                            disabled={generating}
                          >
                            {generating ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : (
                              <Sparkles className="h-3 w-3" />
                            )}
                            {suggestionActionLabel}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" className="z-[80] w-[380px] rounded-2xl p-0 shadow-2xl">
                          <div className="p-4 space-y-4">
                            <button
                              type="button"
                              onClick={() => {
                                setGenerateWithInstructions(false);
                                void handleGenerate();
                              }}
                              disabled={generating}
                              className="w-full flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-left hover:bg-muted transition-colors disabled:opacity-60"
                            >
                              {generating && !generateWithInstructions ? (
                                <RefreshCw className="h-4 w-4 text-primary animate-spin" />
                              ) : (
                                <Sparkles className="h-4 w-4 text-primary" />
                              )}
                              Сгенерировать автоматически
                            </button>

                            <div className="h-px bg-border" />

                            <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                              <Checkbox
                                checked={generateWithInstructions}
                                onCheckedChange={(checked) => setGenerateWithInstructions(Boolean(checked))}
                              />
                              С инструкциями
                            </label>

                            {generateWithInstructions && (
                              <>
                                <Textarea
                                  value={generateInstructions}
                                  onChange={(e) => setGenerateInstructions(e.target.value)}
                                  placeholder="Опишите, что нужно изменить..."
                                  className="min-h-[110px] resize-none text-sm"
                                  maxLength={1200}
                                />

                                <div className="space-y-2">
                                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                    Вставить ключ:
                                  </div>
                                  <div className="flex flex-wrap gap-1.5">
                                    {keywords.map((kw) => (
                                      <button
                                        key={kw}
                                        type="button"
                                        onClick={() => appendInstructionKeyword(kw)}
                                        className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/80 transition-colors"
                                      >
                                        {kw}
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <Button
                                  size="sm"
                                  className="w-full gap-1.5"
                                  onClick={() => void handleGenerate()}
                                  disabled={generating}
                                >
                                  {generating ? (
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Sparkles className="h-3.5 w-3.5" />
                                  )}
                                  Сгенерировать
                                </Button>
                              </>
                            )}
                          </div>
                        </PopoverContent>
                      </Popover>
                    ) : (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => setNewValue(suggestedValue)}
                        disabled={!suggestedValue || newValue === suggestedValue}
                        className="h-7 text-xs gap-1.5"
                      >
                        <Sparkles className="h-3 w-3" /> {suggestionActionLabel}
                      </Button>
                    )}
                  </div>
                  <span className={`text-[11px] ${newValue.length >= maxLen ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    {newValue.length}/{maxLen}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Right: Keywords panel ── */}
          {isRichLayout && (
            <div className="w-[250px] flex-shrink-0 flex flex-col min-h-0 bg-muted/20">
              <div className="px-4 pt-4 pb-2 flex-shrink-0">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Ключевые слова
                </span>
                <span className="text-[11px] text-muted-foreground ml-2">
                  ({keywordsLoading ? '…' : `${usedKeywords.length}/${keywords.length}`})
                </span>
              </div>
              <ScrollArea className="flex-1 min-h-0">
                <div className="px-4 pb-3 space-y-1">
                  {keywordsLoading && (
                    <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      Загрузка ключевых слов...
                    </div>
                  )}
                  {!keywordsLoading && keywords.length === 0 && (
                    <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                      Ключевые слова появятся после подбора рекомендаций.
                    </div>
                  )}
                  {keywords.map((kw) => {
                    const count = newUsages.get(kw) || 0;
                    const used = count > 0;
                    const overused = count > 3;
                    return (
                      <div
                        key={kw}
                        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs transition-colors ${
                          overused
                            ? 'bg-destructive/10 text-foreground'
                            : used
                              ? 'bg-green-500/10 text-foreground'
                              : 'text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        <span className={`truncate ${used ? 'font-medium' : ''}`}>
                          {kw}
                        </span>
                        {used && (
                          <Badge
                            variant="secondary"
                            className={`ml-2 h-5 min-w-[20px] justify-center text-[10px] ${
                              overused
                                ? 'bg-destructive/15 text-destructive'
                                : 'bg-green-500/15 text-green-600'
                            }`}
                          >
                            {count}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>

        <DialogFooter className="px-5 py-2 border-t border-border">
          <div className="flex items-center gap-2 w-full justify-between">
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              {isRichLayout && (
                <span>
                  Ключей: {keywordsLoading ? '…' : `${usedKeywords.length}/${keywords.length}`}
                </span>
              )}
              <span className={newValue.length >= maxLen ? 'text-destructive' : ''}>
                {newValue.length}/{maxLen} симв.
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button size="sm" onClick={handleApply}>
                <Check className="h-3.5 w-3.5 mr-1" />
                Применить
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
