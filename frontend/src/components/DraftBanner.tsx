import React from 'react';
import { FileText, X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CardDraft } from '../types';

interface DraftBannerProps {
  /** Draft authored by someone else */
  draft: CardDraft;
  /** Load the other user's draft into the editor */
  onLoadDraft: () => void;
  /** Dismiss the banner */
  onDismiss: () => void;
}

export default function DraftBanner({ draft, onLoadDraft, onDismiss }: DraftBannerProps) {
  const authorName = draft.author_name || `Пользователь #${draft.author_id}`;
  const updatedAt = new Date(draft.updated_at);
  const timeStr = updatedAt.toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="flex items-center gap-3 rounded-lg border border-amber-300/50 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-700/40 px-4 py-3 mb-4">
      <FileText className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
          {authorName} работает над черновиком
        </p>
        <p className="text-xs text-amber-700 dark:text-amber-400/70 mt-0.5">
          Последнее изменение: {timeStr}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs border-amber-300 text-amber-800 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/40"
        onClick={onLoadDraft}
      >
        <Download className="h-3.5 w-3.5 mr-1.5" />
        Загрузить черновик
      </Button>
      <button
        className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-1"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
