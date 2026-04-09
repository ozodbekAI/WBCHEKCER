export type FeedbacksSection = "waiting" | "answered" | "drafts"

export function parseFeedbacksSection(value: string | null): FeedbacksSection {
  if (value === "drafts") return "drafts"
  if (value === "answered") return "answered"
  return "waiting"
}
