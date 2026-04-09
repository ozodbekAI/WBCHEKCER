import { SelectItem } from "@/components/ui/select"
import type { FeedbacksSection } from "@/components/modules/feedbacks/feedbacks-types"
import {
  SegmentedTabs,
  SearchField,
  FilterBar,
  FilterSelect,
  ControlsRow,
  type SegmentItem,
} from "@/components/shared/page-controls"

type FeedbacksFiltersProps = {
  section: FeedbacksSection
  onSectionChange: (section: FeedbacksSection) => void
  waitingTotalCount: number
  draftQueueCount: number
  answeredTotalCount: number
  q: string
  onQueryChange: (value: string) => void
  rating: string
  onRatingChange: (value: string) => void
  textFilter: string
  onTextFilterChange: (value: string) => void
  photoFilter: string
  onPhotoFilterChange: (value: string) => void
  hasActiveFilters: boolean
  onResetFilters: () => void
  currentListCount: number
}

export function FeedbacksFilters({
  section,
  onSectionChange,
  waitingTotalCount,
  draftQueueCount,
  answeredTotalCount,
  q,
  onQueryChange,
  rating,
  onRatingChange,
  textFilter,
  onTextFilterChange,
  photoFilter,
  onPhotoFilterChange,
  hasActiveFilters,
  onResetFilters,
  currentListCount,
}: FeedbacksFiltersProps) {
  const activeFilterCount = [rating, textFilter, photoFilter].filter(v => v !== "all").length

  const segments: SegmentItem<FeedbacksSection>[] = [
    { key: "waiting", label: "Ожидают", count: waitingTotalCount },
    { key: "drafts", label: "Черновики", count: draftQueueCount },
    { key: "answered", label: "Отвечено", count: answeredTotalCount },
  ]

  return (
    <div className="space-y-2">
      <ControlsRow>
        <SegmentedTabs items={segments} value={section} onChange={onSectionChange} />
        <SearchField
          value={q}
          onChange={onQueryChange}
          placeholder="Поиск…"
          className="flex-1 max-w-[240px]"
        />
        <span className="hidden sm:inline text-xs text-muted-foreground tabular-nums whitespace-nowrap ml-auto">
          {currentListCount} зап.
        </span>
      </ControlsRow>

      <FilterBar
        hasActiveFilters={hasActiveFilters}
        activeCount={activeFilterCount}
        onReset={onResetFilters}
      >
        <FilterSelect value={rating} onValueChange={onRatingChange} placeholder="Рейтинг" isActive={rating !== "all"}>
          <SelectItem value="all">Все рейтинги</SelectItem>
          <SelectItem value="1-2">★ 1–2 Негативные</SelectItem>
          <SelectItem value="3">★ 3 Средние</SelectItem>
          <SelectItem value="4-5">★ 4–5 Позитивные</SelectItem>
        </FilterSelect>

        <FilterSelect value={textFilter} onValueChange={onTextFilterChange} placeholder="Текст" isActive={textFilter !== "all"}>
          <SelectItem value="all">Любой текст</SelectItem>
          <SelectItem value="with">С текстом</SelectItem>
          <SelectItem value="without">Без текста</SelectItem>
        </FilterSelect>

        <FilterSelect value={photoFilter} onValueChange={onPhotoFilterChange} placeholder="Медиа" isActive={photoFilter !== "all"}>
          <SelectItem value="all">Все</SelectItem>
          <SelectItem value="with">С фото/видео</SelectItem>
          <SelectItem value="without">Без медиа</SelectItem>
        </FilterSelect>
      </FilterBar>
    </div>
  )
}
