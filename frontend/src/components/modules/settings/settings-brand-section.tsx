import { Pencil, Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { SaveStateMeta, SignatureItem, ToneOption } from "@/components/modules/settings/settings-types"
import { prettyDate } from "@/components/modules/settings/settings-utils"

function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3.5 3xl:px-5 3xl:py-4 rounded-lg cursor-pointer transition-colors hover:bg-muted/40" onClick={() => onCheckedChange(!checked)}>
      <div>
        <div className="text-sm 3xl:text-[15px] font-medium">{title}</div>
        <div className="text-[13px] 3xl:text-[14px] text-muted-foreground">{description}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  )
}

type SettingsStyleSectionProps = {
  languageOptions: string[]
  language: string
  baseTone: string
  availableToneOptions: ToneOption[]
  addressFormat: string
  answerLength: string
  useCustomerName: boolean
  useProductName: boolean
  onLanguageChange: (value: string) => void
  onBaseToneChange: (value: string) => void
  onAddressFormatChange: (value: string) => void
  onAnswerLengthChange: (value: string) => void
  onUseCustomerNameChange: (value: boolean) => void
  onUseProductNameChange: (value: boolean) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsStyleSection({
  languageOptions,
  language,
  baseTone,
  availableToneOptions,
  addressFormat,
  answerLength,
  useCustomerName,
  useProductName,
  onLanguageChange,
  onBaseToneChange,
  onAddressFormatChange,
  onAnswerLengthChange,
  onUseCustomerNameChange,
  onUseProductNameChange,
}: SettingsStyleSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div>
        <h2 className="text-base 3xl:text-lg font-semibold">Стиль ответов</h2>
        <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
          Язык, тон, формат обращения и длина ответов по умолчанию.
        </p>
      </div>

      <div className="grid gap-4 3xl:gap-5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Язык ответов</Label>
          <Select value={language} onValueChange={onLanguageChange}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map((v) => (
                <SelectItem key={v} value={v} className="text-sm 3xl:text-[14px]">
                  {v === "ru" ? "Русский" : v === "en" ? "English" : v === "uz" ? "O'zbek" : v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Базовая тональность</Label>
          <Select value={baseTone} onValueChange={onBaseToneChange}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableToneOptions.map((item) => (
                <SelectItem key={item.value} value={item.value} className="text-sm 3xl:text-[14px]">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Формат обращения</Label>
          <Select value={addressFormat} onValueChange={onAddressFormatChange}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="vy_caps" className="text-sm 3xl:text-[14px]">«Вы» с заглавной</SelectItem>
              <SelectItem value="vy_lower" className="text-sm 3xl:text-[14px]">«вы» со строчной</SelectItem>
              <SelectItem value="ty" className="text-sm 3xl:text-[14px]">Неформальное «ты»</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[13px] 3xl:text-[14px]">Длина ответа</Label>
          <Select value={answerLength} onValueChange={onAnswerLengthChange}>
            <SelectTrigger className="h-9 3xl:h-10 text-sm 3xl:text-[15px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="short" className="text-sm 3xl:text-[14px]">Краткий</SelectItem>
              <SelectItem value="default" className="text-sm 3xl:text-[14px]">Стандартный</SelectItem>
              <SelectItem value="long" className="text-sm 3xl:text-[14px]">Развёрнутый</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 divide-y divide-border/40">
        <ToggleRow
          title="Имя покупателя"
          description="Использовать имя из профиля в ответах"
          checked={useCustomerName}
          onCheckedChange={onUseCustomerNameChange}
        />
        <ToggleRow
          title="Название товара"
          description="Упоминать товар для персонализации"
          checked={useProductName}
          onCheckedChange={onUseProductNameChange}
        />
      </div>
    </div>
  )
}

type SettingsBrandSectionProps = {
  brands: string[]
  filterBrand: string
  filterRating: string
  filteredSignatures: SignatureItem[]
  onFilterBrandChange: (value: string) => void
  onFilterRatingChange: (value: string) => void
  onOpenCreate: () => void
  onEdit: (index: number) => void
  onRemove: (index: number) => void
  saveStateMeta: SaveStateMeta
}

export function SettingsBrandSection({
  brands,
  filterBrand,
  filterRating,
  filteredSignatures,
  onFilterBrandChange,
  onFilterRatingChange,
  onOpenCreate,
  onEdit,
  onRemove,
}: SettingsBrandSectionProps) {
  return (
    <div className="space-y-5 3xl:space-y-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base 3xl:text-lg font-semibold">Подписи</h2>
          <p className="text-[13px] 3xl:text-[14px] text-muted-foreground mt-0.5">
            Стандартизация финальной части ответов по брендам.
          </p>
        </div>
        <Button size="sm" className="h-8 3xl:h-9 text-[13px] 3xl:text-[14px] gap-1.5" onClick={onOpenCreate}>
          <Plus className="h-3.5 w-3.5 3xl:h-4 3xl:w-4" />
          Добавить
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select value={filterBrand} onValueChange={onFilterBrandChange}>
          <SelectTrigger className="h-8 3xl:h-9 w-[160px] 3xl:w-[180px] text-[13px] 3xl:text-[14px]">
            <SelectValue placeholder="Все бренды" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[13px] 3xl:text-[14px]">Все бренды</SelectItem>
            {brands.map((brand) => (
              <SelectItem key={brand} value={brand} className="text-[13px] 3xl:text-[14px]">{brand}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterRating} onValueChange={onFilterRatingChange}>
          <SelectTrigger className="h-8 3xl:h-9 w-[160px] 3xl:w-[180px] text-[13px] 3xl:text-[14px]">
            <SelectValue placeholder="Все рейтинги" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-[13px] 3xl:text-[14px]">Все рейтинги</SelectItem>
            <SelectItem value="none" className="text-[13px] 3xl:text-[14px]">Для всех</SelectItem>
            {[5, 4, 3, 2, 1].map((r) => (
              <SelectItem key={r} value={String(r)} className="text-[13px] 3xl:text-[14px]">{r} ★</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[13px] 3xl:text-[14px] h-9 3xl:h-10">Подпись</TableHead>
              <TableHead className="text-[13px] 3xl:text-[14px] h-9 3xl:h-10">Бренд</TableHead>
              <TableHead className="text-[13px] 3xl:text-[14px] h-9 3xl:h-10">Рейтинг</TableHead>
              <TableHead className="text-[13px] 3xl:text-[14px] h-9 3xl:h-10">Дата</TableHead>
              <TableHead className="text-[13px] 3xl:text-[14px] h-9 3xl:h-10 w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredSignatures.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-sm 3xl:text-[15px] text-muted-foreground">
                  Подписей пока нет
                </TableCell>
              </TableRow>
            ) : (
              filteredSignatures.map((sig, i) => (
                <TableRow key={`${sig.text}-${sig.brand}-${i}`}>
                  <TableCell className="text-sm 3xl:text-[15px] py-2 3xl:py-3">{sig.text}</TableCell>
                  <TableCell className="text-[13px] 3xl:text-[14px] py-2 3xl:py-3 text-muted-foreground">{sig.brand === "all" ? "Все" : sig.brand}</TableCell>
                  <TableCell className="text-[13px] 3xl:text-[14px] py-2 3xl:py-3 text-muted-foreground">{sig.rating == null ? "Все" : `${sig.rating}★`}</TableCell>
                  <TableCell className="text-[13px] 3xl:text-[14px] py-2 3xl:py-3 text-muted-foreground">{prettyDate(sig.created_at)}</TableCell>
                  <TableCell className="py-2 3xl:py-3">
                    <div className="flex items-center gap-0.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7 3xl:h-8 3xl:w-8" onClick={() => onEdit(i)}>
                        <Pencil className="h-3.5 w-3.5 3xl:h-4 3xl:w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 3xl:h-8 3xl:w-8" onClick={() => onRemove(i)}>
                        <Trash2 className="h-3.5 w-3.5 3xl:h-4 3xl:w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
