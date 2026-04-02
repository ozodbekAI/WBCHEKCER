"""
Card Analysis Engine
Analyzes WB cards and detects issues with suggestions
"""
from typing import List, Dict, Any, Optional
from datetime import datetime
import re

from ..models import Card, CardIssue, IssueSeverity, IssueCategory, IssueStatus
from ..core.config import settings
from .title_policy import validate_title
from .text_policy import validate_description


class CardAnalyzer:
    """Analyzes product cards and generates issues with suggestions"""
    
    def __init__(self):
        self.rules = self._load_rules()
    
    def _load_rules(self) -> List[Dict[str, Any]]:
        """Load analysis rules"""
        return [
            # === CRITICAL ISSUES ===
            {
                "code": "no_title",
                "severity": IssueSeverity.CRITICAL,
                "category": IssueCategory.TITLE,
                "check": self._check_no_title,
                "title": "Отсутствует название товара",
                "description": "Карточка без названия не будет отображаться в поиске",
                "score_impact": 30,
            },
            {
                "code": "title_too_short",
                "severity": IssueSeverity.CRITICAL,
                "category": IssueCategory.TITLE,
                "check": self._check_title_too_short,
                "title": "Название слишком короткое",
                "description": f"Название должно быть минимум {settings.MIN_TITLE_LENGTH} символов для хорошей индексации",
                "score_impact": 20,
            },
            {
                "code": "no_photos",
                "severity": IssueSeverity.CRITICAL,
                "category": IssueCategory.PHOTOS,
                "check": self._check_no_photos,
                "title": "Отсутствуют фотографии",
                "description": "Карточка без фотографий не будет показываться покупателям",
                "score_impact": 30,
            },
            {
                "code": "no_description",
                "severity": IssueSeverity.CRITICAL,
                "category": IssueCategory.DESCRIPTION,
                "check": self._check_no_description,
                "title": "Отсутствует описание",
                "description": "Описание важно для SEO и конверсии",
                "score_impact": 20,
            },
            {
                "code": "wrong_category",
                "severity": IssueSeverity.CRITICAL,
                "category": IssueCategory.CATEGORY,
                "check": self._check_wrong_category,
                "title": "Неверная категория",
                "description": "Товар размещен в неправильной категории, что снижает показы",
                "score_impact": 25,
            },
            {
                "code": "missing_required_chars",
                "severity": IssueSeverity.CRITICAL,
                "category": IssueCategory.CHARACTERISTICS,
                "check": self._check_missing_required_chars,
                "title": "Не заполнены обязательные характеристики",
                "description": "Обязательные характеристики влияют на фильтры поиска",
                "score_impact": 20,
            },
            
            # === WARNINGS ===
            {
                "code": "few_photos",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.PHOTOS,
                "check": self._check_few_photos,
                "title": "Недостаточно фотографий",
                "description": f"Если в карточке меньше {settings.MEDIA_WARNING_PHOTOS_COUNT} фото, она попадает в блок медиа-задач и теряет конверсию",
                "score_impact": 10,
            },
            {
                "code": "description_too_short",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.DESCRIPTION,
                "check": self._check_description_too_short,
                "title": "Описание слишком короткое",
                "description": f"Описание должно быть минимум {settings.MIN_DESCRIPTION_LENGTH} символов",
                "score_impact": 10,
            },
            {
                "code": "description_too_long",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.DESCRIPTION,
                "check": self._check_description_too_long,
                "title": "Описание слишком длинное",
                "description": f"Описание не должно превышать {settings.MAX_DESCRIPTION_LENGTH} символов",
                "score_impact": 8,
            },
            {
                "code": "description_policy_violation",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.DESCRIPTION,
                "check": self._check_description_policy_violation,
                "title": "Описание нарушает правила WB",
                "description": "Описание не соответствует формату и требованиям WB",
                "score_impact": 12,
            },
            {
                "code": "title_too_long",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.TITLE,
                "check": self._check_title_too_long,
                "title": "Название слишком длинное",
                "description": f"Название обрезается после {settings.MAX_TITLE_LENGTH} символов",
                "score_impact": 5,
            },
            {
                "code": "title_policy_violation",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.TITLE,
                "check": self._check_title_policy_violation,
                "title": "Название нарушает правила WB",
                "description": "Название не соответствует структуре или содержит запрещённые признаки",
                "score_impact": 12,
            },
            {
                "code": "no_video",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.VIDEO,
                "check": self._check_no_video,
                "title": "Отсутствует видео",
                "description": "Видео повышает конверсию на 30-40%",
                "score_impact": 10,
            },
            {
                "code": "composition_mismatch",
                "severity": IssueSeverity.WARNING,
                "category": IssueCategory.CHARACTERISTICS,
                "check": self._check_composition_mismatch,
                "title": "Конфликт в характеристиках",
                "description": "Состав в характеристиках не соответствует описанию",
                "score_impact": 15,
            },
            
            # === IMPROVEMENTS ===
            {
                "code": "seo_keywords_missing",
                "severity": IssueSeverity.IMPROVEMENT,
                "category": IssueCategory.SEO,
                "check": self._check_seo_keywords,
                "title": "SEO-оптимизация",
                "description": "Добавьте ключевые слова для улучшения поиска",
                "score_impact": 5,
            },
            {
                "code": "add_more_photos",
                "severity": IssueSeverity.IMPROVEMENT,
                "category": IssueCategory.PHOTOS,
                "check": self._check_can_add_photos,
                "title": "Добавьте больше фото",
                "description": "Дополнительные фото улучшают конверсию",
                "score_impact": 5,
            },
        ]
    
    def analyze_card(self, card: Card) -> List[Dict[str, Any]]:
        """Analyze a single card and return list of issues"""
        issues = []
        
        for rule in self.rules:
            result = rule["check"](card)
            if result["has_issue"]:
                issue = {
                    "code": rule["code"],
                    "severity": rule["severity"],
                    "category": rule["category"],
                    "title": rule["title"],
                    "description": rule["description"],
                    "score_impact": rule["score_impact"],
                    "current_value": result.get("current_value"),
                    "suggested_value": result.get("suggested_value"),
                    "alternatives": result.get("alternatives", []),
                    "field_path": result.get("field_path"),
                }
                issues.append(issue)
        
        return issues
    
    def calculate_score(self, card: Card, issues: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Calculate card score based on issues"""
        max_score = 100
        
        # Base scores by category
        scores = {
            "title": 20,
            "description": 20,
            "photos": 20,
            "video": 10,
            "characteristics": 20,
            "seo": 10,
        }
        
        # Deduct for issues
        deductions = {cat: 0 for cat in scores}
        
        for issue in issues:
            cat = issue["category"].value if hasattr(issue["category"], "value") else issue["category"]
            if cat in deductions:
                deductions[cat] += issue["score_impact"]
        
        # Calculate final scores
        breakdown = {}
        total = 0
        for cat, max_cat_score in scores.items():
            cat_score = max(0, max_cat_score - deductions.get(cat, 0))
            breakdown[f"{cat}_score"] = cat_score
            total += cat_score
        
        breakdown["total_score"] = total
        breakdown["max_possible"] = max_score
        
        return breakdown
    
    # === CHECK METHODS ===
    
    def _check_no_title(self, card: Card) -> Dict[str, Any]:
        if not card.title or not card.title.strip():
            return {
                "has_issue": True,
                "current_value": None,
                "suggested_value": None,  # AI generates title via dedicated prompt
                "field_path": "title",
            }
        return {"has_issue": False}
    
    def _check_title_too_short(self, card: Card) -> Dict[str, Any]:
        if card.title and len(card.title.strip()) < settings.MIN_TITLE_LENGTH:
            return {
                "has_issue": True,
                "current_value": card.title,
                "suggested_value": None,  # AI generates title via dedicated prompt
                "field_path": "title",
            }
        return {"has_issue": False}
    
    def _check_title_too_long(self, card: Card) -> Dict[str, Any]:
        if card.title and len(card.title.strip()) > settings.MAX_TITLE_LENGTH:
            return {
                "has_issue": True,
                "current_value": card.title,
                "suggested_value": card.title[:settings.MAX_TITLE_LENGTH].rsplit(" ", 1)[0],
                "field_path": "title",
            }
        return {"has_issue": False}

    def _check_title_policy_violation(self, card: Card) -> Dict[str, Any]:
        if not card.title or not card.title.strip():
            return {"has_issue": False}
        title = card.title.strip()
        if len(title) < settings.MIN_TITLE_LENGTH or len(title) > settings.MAX_TITLE_LENGTH:
            return {"has_issue": False}

        raw = card.raw_data if isinstance(card.raw_data, dict) else {}
        card_ctx: Dict[str, Any] = {
            "title": card.title or "",
            "description": card.description or "",
            "brand": card.brand or "",
            "subjectName": raw.get("subjectName") or card.subject_name or "",
            "subject_name": card.subject_name or "",
            "category_name": card.category_name or "",
            "characteristics": raw.get("characteristics") or card.characteristics or {},
        }
        valid, _ = validate_title(title, card_ctx, settings.MIN_TITLE_LENGTH, settings.MAX_TITLE_LENGTH)
        if not valid:
            return {
                "has_issue": True,
                "current_value": card.title,
                "suggested_value": None,  # AI generates title via dedicated prompt
                "field_path": "title",
            }
        return {"has_issue": False}
    
    def _check_no_photos(self, card: Card) -> Dict[str, Any]:
        if card.photos_count == 0:
            return {
                "has_issue": True,
                "current_value": "0 фото",
                "field_path": "photos",
            }
        return {"has_issue": False}
    
    def _check_few_photos(self, card: Card) -> Dict[str, Any]:
        threshold = max(1, int(getattr(settings, "MEDIA_WARNING_PHOTOS_COUNT", 30) or 30))
        if 0 < card.photos_count < threshold:
            return {
                "has_issue": True,
                "current_value": f"{card.photos_count} фото",
                "suggested_value": f"Добавьте ещё {threshold - card.photos_count} фото, чтобы довести карточку до {threshold}",
                "field_path": "photos",
            }
        return {"has_issue": False}

    def _check_can_add_photos(self, card: Card) -> Dict[str, Any]:
        media_threshold = max(1, int(getattr(settings, "MEDIA_WARNING_PHOTOS_COUNT", 30) or 30))
        recommended_threshold = max(media_threshold, int(getattr(settings, "RECOMMENDED_PHOTOS_COUNT", media_threshold) or media_threshold))
        if media_threshold <= card.photos_count < recommended_threshold:
            return {
                "has_issue": True,
                "current_value": f"{card.photos_count} фото",
                "suggested_value": f"Рекомендуем {recommended_threshold} фото",
                "field_path": "photos",
            }
        return {"has_issue": False}
    
    def _check_no_description(self, card: Card) -> Dict[str, Any]:
        if not card.description or not card.description.strip():
            return {
                "has_issue": True,
                "current_value": None,
                "suggested_value": None,  # AI generates description via dedicated prompt
                "field_path": "description",
            }
        return {"has_issue": False}
    
    def _check_description_too_short(self, card: Card) -> Dict[str, Any]:
        if card.description and len(card.description.strip()) < settings.MIN_DESCRIPTION_LENGTH:
            return {
                "has_issue": True,
                "current_value": card.description[:500],
                "suggested_value": None,  # AI will generate full text
                "field_path": "description",
            }
        return {"has_issue": False}

    def _check_description_too_long(self, card: Card) -> Dict[str, Any]:
        if card.description and len(card.description.strip()) > settings.MAX_DESCRIPTION_LENGTH:
            return {
                "has_issue": True,
                "current_value": card.description[:500],
                "suggested_value": None,
                "field_path": "description",
            }
        return {"has_issue": False}

    def _check_description_policy_violation(self, card: Card) -> Dict[str, Any]:
        if not card.description or not card.description.strip():
            return {"has_issue": False}
        text = card.description.strip()
        if len(text) < settings.MIN_DESCRIPTION_LENGTH or len(text) > settings.MAX_DESCRIPTION_LENGTH:
            return {"has_issue": False}

        raw = card.raw_data if isinstance(card.raw_data, dict) else {}
        card_ctx: Dict[str, Any] = {
            "title": card.title or "",
            "description": text,
            "brand": card.brand or "",
            "subjectName": raw.get("subjectName") or card.subject_name or "",
            "subject_name": card.subject_name or "",
            "category_name": card.category_name or "",
            "characteristics": raw.get("characteristics") or card.characteristics or {},
        }
        valid, _ = validate_description(
            text,
            card_ctx,
            settings.MIN_DESCRIPTION_LENGTH,
            settings.MAX_DESCRIPTION_LENGTH,
        )
        if not valid:
            return {
                "has_issue": True,
                "current_value": text[:500],
                "suggested_value": None,
                "field_path": "description",
            }
        return {"has_issue": False}
    
    def _check_no_video(self, card: Card) -> Dict[str, Any]:
        if card.videos_count == 0:
            return {
                "has_issue": True,
                "current_value": "Нет видео",
                "suggested_value": "Добавьте видео для повышения конверсии",
                "field_path": "videos",
            }
        return {"has_issue": False}
    
    def _check_wrong_category(self, card: Card) -> Dict[str, Any]:
        # Simplified check - in real implementation would use ML/rules
        suspicious_patterns = [
            (r"платье", ["одежда", "женская одежда"]),
            (r"кроссовки", ["обувь", "спортивная обувь"]),
            (r"сумка", ["аксессуары", "сумки"]),
        ]
        
        if card.title:
            title_lower = card.title.lower()
            category_lower = (card.category_name or "").lower()
            
            for pattern, expected_cats in suspicious_patterns:
                if re.search(pattern, title_lower):
                    if not any(cat in category_lower for cat in expected_cats):
                        return {
                            "has_issue": True,
                            "current_value": card.category_name,
                            "suggested_value": expected_cats[0].capitalize(),
                            "alternatives": [c.capitalize() for c in expected_cats[1:]],
                            "field_path": "category",
                        }
        
        return {"has_issue": False}
    
    def _check_missing_required_chars(self, card: Card) -> Dict[str, Any]:
        # Check for common required characteristics
        required = ["Состав", "Материал", "Размер", "Цвет"]
        chars = card.characteristics or {}
        
        missing = []
        for req in required:
            found = any(req.lower() in k.lower() for k in chars.keys())
            if not found:
                missing.append(req)
        
        if missing:
            return {
                "has_issue": True,
                "current_value": f"Не заполнено: {', '.join(missing)}",
                "suggested_value": None,  # AI will provide concrete values
                "field_path": "characteristics",
            }
        return {"has_issue": False}
    
    def _check_composition_mismatch(self, card: Card) -> Dict[str, Any]:
        # Check if composition in characteristics matches description
        chars = card.characteristics or {}
        composition = None
        composition_key = "Состав"  # default Russian name
        
        for k, v in chars.items():
            if "состав" in k.lower():
                composition = v
                composition_key = k
                break
        
        if composition and card.description:
            # Check for common mismatches
            comp_lower = str(composition).lower()
            desc_lower = card.description.lower()
            
            materials = ["хлопок", "полиэстер", "вискоза", "шелк", "лен", "шерсть"]
            comp_materials = [m for m in materials if m in comp_lower]
            desc_materials = [m for m in materials if m in desc_lower]
            
            if comp_materials and desc_materials:
                comp_set = set(comp_materials)
                desc_set = set(desc_materials)
                # If description mentions only a subset of composition materials,
                # treat it as acceptable (not a contradiction).
                if desc_set.issubset(comp_set):
                    return {"has_issue": False}
                # Conflict only when description introduces materials absent in composition.
                if not desc_set.issubset(comp_set):
                    return {
                        "has_issue": True,
                        "current_value": composition,
                        "suggested_value": self._suggest_composition(comp_materials),
                        "alternatives": [self._suggest_composition(desc_materials)],
                        "field_path": f"characteristics.{composition_key}",
                    }
        
        return {"has_issue": False}
    
    def _check_seo_keywords(self, card: Card) -> Dict[str, Any]:
        # Simplified SEO check
        if card.title and card.description:
            # Check if title keywords are in description
            title_words = set(card.title.lower().split())
            desc_words = set(card.description.lower().split())
            
            important_words = title_words - {"для", "и", "в", "на", "с", "из"}
            missing = important_words - desc_words
            
            if len(missing) > len(important_words) * 0.5:
                missing_list = list(missing)[:5]
                return {
                    "has_issue": True,
                    "current_value": card.description[:500],
                    "suggested_value": None,  # AI will rewrite full description with SEO keywords
                    "field_path": "description",
                    "missing_keywords": missing_list,
                }
        
        return {"has_issue": False}
    
    # === SUGGESTION HELPERS ===
    
    def _suggest_title(self, card: Card) -> str:
        """Title text generation is AI-only."""
        return ""
    
    def _improve_title(self, card: Card) -> str:
        """Title text generation is AI-only."""
        return ""
    
    def _suggest_description(self, card: Card) -> str:
        """Description text generation is AI-only."""
        return ""
    
    def _suggest_composition(self, materials: List[str]) -> str:
        """Generate composition suggestion"""
        if len(materials) == 1:
            return f"100% {materials[0]}"
        elif len(materials) == 2:
            return f"95% {materials[0]}, 5% {materials[1]}"
        return ", ".join(materials)


# Singleton instance
card_analyzer = CardAnalyzer()
