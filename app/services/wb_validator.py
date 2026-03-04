"""
WB Card Validator Service
Based on wbchecknew/wb_card_validator.py
Validates cards against WB catalog limits and allowed values.
Includes per-subject characteristic metadata from charcs/ and validation/ files.
"""
from __future__ import annotations

import json
import math
import zipfile
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from ..core.config import settings


def _as_list(v: Any) -> List[Any]:
    """Convert value to list"""
    if v is None:
        return []
    if isinstance(v, list):
        return v
    return [v]


def _norm(s: str) -> str:
    """Normalize string for comparison"""
    return " ".join((s or "").strip().lower().split())


def _similarity(a: str, b: str) -> float:
    """Fuzzy string similarity ratio (0..1)"""
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def find_best_match(value: str, allowed: List[str], threshold: float = 0.72) -> Optional[str]:
    """
    Find the best matching allowed value for a given value.
    Returns the exact allowed-list string, or None if no match above threshold.
    """
    if not allowed:
        return None
    nv = _norm(value)
    # 1) Exact match (case-insensitive)
    for av in allowed:
        if _norm(av) == nv:
            return av
    # 2) Best fuzzy match
    best_val: Optional[str] = None
    best_score = 0.0
    for av in allowed:
        score = _similarity(value, av)
        if score > best_score:
            best_score = score
            best_val = av
    if best_score >= threshold and best_val is not None:
        return best_val
    return None


@dataclass
class CharMetadata:
    """Metadata for a single characteristic from charcs/{subjectID}.json"""
    charc_id: int
    name: str
    required: bool = False
    unit_name: str = ""
    max_count: int = 0
    popular: bool = False
    charc_type: int = 1  # 0=system, 1=string, 4=number
    is_fixed: bool = False
    is_conditional: bool = False
    condition: Dict[str, Any] = field(default_factory=dict)
    note: str = ""


class DataCatalog:
    """WB Data Catalog - loads limits, allowed values, and per-subject metadata from data.zip"""
    
    def __init__(self, data_zip_path: Union[str, Path]):
        self.data_zip_path = str(data_zip_path)
        self.zf = zipfile.ZipFile(self.data_zip_path, "r")

        # Limits by characteristic name
        self.limits_by_name: Dict[str, Dict[str, int]] = {}

        # Allowed values by characteristic name
        self.sprav_by_name: Dict[str, List[str]] = {}

        # SEO keywords by subject name (category)
        self.keywords_by_subject: Dict[str, List[str]] = {}

        # Color values
        self.colors_allowed: Set[str] = set()
        self.colors_allowed_list: List[str] = []
        # Color hierarchy: parent -> shades and shade -> parent
        self.color_parent_to_children: Dict[str, List[str]] = {}
        self.color_value_to_parent: Dict[str, str] = {}
        self.color_parents: List[str] = []
        # Frequency stats from cards_raw (for better "closest shades" ordering)
        self.color_freq: Dict[str, int] = {}
        self.color_parent_freq: Dict[str, int] = {}

        # Per-subject characteristic metadata: subject_id -> list of CharMetadata
        self._charcs_cache: Dict[int, List[CharMetadata]] = {}

        # Per-subject validation rules: subject_id -> {charc_id_str: rule_dict}
        self._validation_cache: Dict[int, Dict[str, Dict]] = {}

        # Set of available subject IDs in data.zip
        self._available_subjects: Set[int] = set()

        self._load_limits()
        self._load_sprav()
        self._load_colors()
        self._load_cards_raw_color_stats()
        self._load_keywords()
        self._scan_available_subjects()

    def close(self) -> None:
        """Close zip file"""
        try:
            self.zf.close()
        except Exception:
            pass

    def _read_json(self, inner_path: str) -> Any:
        """Read JSON from zip"""
        with self.zf.open(inner_path) as f:
            return json.load(f)

    def _scan_available_subjects(self) -> None:
        """Scan charcs/ folder to know which subject IDs are available"""
        for name in self.zf.namelist():
            if name.startswith("data/charcs/") and name.endswith(".json"):
                try:
                    sid = int(name.split("/")[-1].replace(".json", ""))
                    self._available_subjects.add(sid)
                except ValueError:
                    pass

    def _load_limits(self) -> None:
        """Load characteristic limits"""
        try:
            data = self._read_json("data/Справочник лимитов.json")
            if isinstance(data, dict):
                self.limits_by_name = data
        except KeyError:
            self.limits_by_name = {}

    def _load_keywords(self) -> None:
        """Load SEO keywords by subject/category from Ключевые_слова.json"""
        try:
            data = self._read_json("data/Ключевые_слова.json")
            if isinstance(data, dict):
                self.keywords_by_subject = {k.lower(): v for k, v in data.items() if isinstance(v, list)}
        except KeyError:
            self.keywords_by_subject = {}

    def _load_sprav(self) -> None:
        """Load allowed values from справочники"""
        merged: Dict[str, List[str]] = {}
        
        for p in ("data/Справочник генерация.json", "data/fill_dict.json"):
            try:
                d = self._read_json(p)
            except KeyError:
                continue
            if not isinstance(d, dict):
                continue
            for name, arr in d.items():
                if name not in merged:
                    merged[name] = []
                if isinstance(arr, list):
                    merged[name].extend([str(x) for x in arr if x])

        # Dedupe and clean
        cleaned: Dict[str, List[str]] = {}
        for nm, vals in merged.items():
            seen = set()
            out = []
            for v in vals:
                nv = _norm(v)
                if nv and nv not in seen:
                    seen.add(nv)
                    out.append(v)
            cleaned[nm] = out

        self.sprav_by_name = cleaned

    def _load_colors(self) -> None:
        """Load color names"""
        try:
            d = self._read_json("data/color_names.json")
        except KeyError:
            self.colors_allowed = set()
            self.colors_allowed_list = []
            return

        items = None
        if isinstance(d, dict):
            items = d.get("data")
        if not isinstance(items, list):
            self.colors_allowed = set()
            self.colors_allowed_list = []
            return

        vals: List[str] = []
        parent_to_children: Dict[str, Set[str]] = {}
        value_to_parent: Dict[str, str] = {}
        parents_set: Set[str] = set()
        for it in items:
            if not isinstance(it, dict):
                continue
            nm = it.get("name")
            parent = it.get("parentName")
            if isinstance(nm, str) and nm.strip():
                nm_s = nm.strip()
                vals.append(nm_s)
            else:
                nm_s = ""
            if isinstance(parent, str) and parent.strip():
                parent_s = parent.strip()
                vals.append(parent_s)
                parents_set.add(parent_s)
                if nm_s:
                    parent_to_children.setdefault(parent_s, set()).add(nm_s)
                    value_to_parent[_norm(nm_s)] = parent_s
                    value_to_parent[_norm(parent_s)] = parent_s

        # Dedupe
        seen = set()
        out = []
        for v in vals:
            nv = _norm(v)
            if not nv or nv in seen:
                continue
            seen.add(nv)
            out.append(v)
        out_sorted = sorted(out, key=lambda x: _norm(x))

        self.colors_allowed = set(_norm(x) for x in out_sorted)
        self.colors_allowed_list = out_sorted
        self.color_parent_to_children = {
            p: sorted(children, key=lambda x: _norm(x))
            for p, children in parent_to_children.items()
        }
        self.color_value_to_parent = value_to_parent
        self.color_parents = sorted(list(parents_set), key=lambda x: _norm(x))

    def _load_cards_raw_color_stats(self) -> None:
        """Load color frequencies from cards_raw to rank closest shades inside parent groups."""
        try:
            cards = self._read_json("data/cards_raw.json")
        except KeyError:
            self.color_freq = {}
            self.color_parent_freq = {}
            return
        if not isinstance(cards, list):
            self.color_freq = {}
            self.color_parent_freq = {}
            return

        color_freq: Dict[str, int] = {}
        parent_freq: Dict[str, int] = {}

        for card in cards:
            if not isinstance(card, dict):
                continue
            chars = card.get("characteristics") or []
            if not isinstance(chars, list):
                continue

            for ch in chars:
                if not isinstance(ch, dict):
                    continue
                name = str(ch.get("name") or "").strip().lower()
                if "цвет" not in name:
                    continue

                vals = ch.get("value")
                if vals is None:
                    vals = ch.get("values")
                vals_l = vals if isinstance(vals, list) else _as_list(vals)
                for v in vals_l:
                    if not isinstance(v, str) or not v.strip():
                        continue
                    c = v.strip()
                    color_freq[c] = color_freq.get(c, 0) + 1
                    parent = self.get_color_parent(c)
                    if parent:
                        parent_freq[parent] = parent_freq.get(parent, 0) + 1

        self.color_freq = color_freq
        self.color_parent_freq = parent_freq

    # ── Per-subject metadata ────────────────────────────

    def get_subject_chars(self, subject_id: int) -> List[CharMetadata]:
        """
        Get characteristic metadata for a subject.
        Loads from charcs/{subjectID}.json on first call, then caches.
        """
        if subject_id in self._charcs_cache:
            return self._charcs_cache[subject_id]

        if subject_id not in self._available_subjects:
            self._charcs_cache[subject_id] = []
            return []

        try:
            data = self._read_json(f"data/charcs/{subject_id}.json")
        except KeyError:
            self._charcs_cache[subject_id] = []
            return []

        chars_list: List[CharMetadata] = []
        for ch in (data.get("characteristics") or []):
            cm = CharMetadata(
                charc_id=ch.get("charcID", 0),
                name=ch.get("name", ""),
                required=ch.get("required", False),
                unit_name=ch.get("unitName", ""),
                max_count=ch.get("maxCount", 0),
                popular=ch.get("popular", False),
                charc_type=ch.get("charcType", 1),
                is_fixed=ch.get("is_fixed", False),
                is_conditional=ch.get("is_conditional", False),
                condition=ch.get("condition", {}),
                note=ch.get("note", ""),
            )
            chars_list.append(cm)

        self._charcs_cache[subject_id] = chars_list
        return chars_list

    def get_char_metadata(self, subject_id: int, char_name: str) -> Optional[CharMetadata]:
        """Find CharMetadata by name within a subject"""
        for cm in self.get_subject_chars(subject_id):
            if _norm(cm.name) == _norm(char_name):
                return cm
        return None

    def get_validation_rules(self, subject_id: int) -> Dict[str, Dict]:
        """
        Get validation rules for a subject.
        Loads from validation/{subjectID}.json on first call, then caches.
        Returns {charc_id_str: {name, type, required, maxCount, constraints}}
        """
        if subject_id in self._validation_cache:
            return self._validation_cache[subject_id]

        try:
            data = self._read_json(f"data/validation/{subject_id}.json")
        except KeyError:
            self._validation_cache[subject_id] = {}
            return {}

        rules = data.get("rules", {})
        if not isinstance(rules, dict):
            rules = {}
        self._validation_cache[subject_id] = rules
        return rules

    def should_skip_char(self, subject_id: int, char_name: str) -> bool:
        """Check if a characteristic should be skipped (is_fixed or condition.action=skip)"""
        cm = self.get_char_metadata(subject_id, char_name)
        if cm is None:
            return False
        if cm.is_fixed:
            return True
        if cm.is_conditional and cm.condition.get("action") == "skip":
            return True
        return False

    # ── Core lookups ──────────────────────────────────

    def get_limits(self, char_name: str) -> Optional[Dict[str, int]]:
        """Get min/max limits for characteristic"""
        return self.limits_by_name.get(char_name)

    def get_allowed_values(self, char_name: str) -> Optional[List[str]]:
        """Get allowed values for characteristic"""
        if _norm(char_name) == "цвет":
            return self.colors_allowed_list or None
        return self.sprav_by_name.get(char_name)

    def get_keywords_for_subject(self, subject_name: str) -> List[str]:
        """Get SEO keywords for a subject/category name"""
        if not subject_name:
            return []
        return self.keywords_by_subject.get(subject_name.lower(), [])

    def get_color_parent_names(self) -> List[str]:
        """Return normalized parent color names (compact list for AI selection)."""
        return list(self.color_parents)

    def get_color_parent(self, value: str) -> Optional[str]:
        """Resolve color shade/parent to parent color."""
        if not value:
            return None
        nv = _norm(value)
        parent = self.color_value_to_parent.get(nv)
        if parent:
            return parent
        # Fallback: try fuzzy against known parent names
        best_parent = find_best_match(value, self.color_parents, threshold=0.78)
        if best_parent:
            return best_parent
        return None

    def suggest_related_colors(
        self,
        selected_parent_or_color: str,
        seed_colors: Optional[List[str]] = None,
        total_count: int = 4,
    ) -> List[str]:
        """
        Build final color palette:
        1) select parent
        2) return main color + closest 3/4 shades from that parent
        """
        parent = self.get_color_parent(selected_parent_or_color) or (selected_parent_or_color or "").strip()
        if not parent:
            return []

        children = list(self.color_parent_to_children.get(parent, []))
        if not children:
            # Parent exists but no children known -> fallback to parent only
            return [parent]

        seeds = [s.strip() for s in (seed_colors or []) if isinstance(s, str) and s.strip()]

        # Main color:
        # - if selected is already a child from this parent, keep it main
        # - otherwise choose best child by seed similarity + frequency
        selected_norm = _norm(selected_parent_or_color or "")
        main_color = None
        for ch in children:
            if _norm(ch) == selected_norm:
                main_color = ch
                break
        if main_color is None:
            scored_main: List[Tuple[float, str]] = []
            for ch in children:
                sim = 0.0
                if seeds:
                    sim = max(_similarity(ch, s) for s in seeds)
                freq = self.color_freq.get(ch, 0)
                score = (sim * 3.0) + (math.log1p(freq) * 0.2)
                scored_main.append((score, ch))
            scored_main.sort(key=lambda x: (-x[0], _norm(x[1])))
            main_color = scored_main[0][1] if scored_main else children[0]

        # Other close colors within parent
        scored: List[Tuple[float, str]] = []
        for ch in children:
            if _norm(ch) == _norm(main_color):
                continue
            sim_to_main = _similarity(ch, main_color)
            sim_to_seed = max((_similarity(ch, s) for s in seeds), default=0.0)
            freq = self.color_freq.get(ch, 0)
            score = (sim_to_main * 2.5) + (sim_to_seed * 1.5) + (math.log1p(freq) * 0.2)
            scored.append((score, ch))
        scored.sort(key=lambda x: (-x[0], _norm(x[1])))

        n = max(3, min(int(total_count or 4), 5))
        out = [main_color]
        for _, ch in scored:
            if len(out) >= n:
                break
            out.append(ch)

        return out

    def is_allowed(self, char_name: str, value: str) -> bool:
        """Check if value is allowed"""
        if _norm(char_name) == "цвет":
            return _norm(value) in self.colors_allowed
        allowed = self.get_allowed_values(char_name) or []
        allowed_norm = {_norm(x) for x in allowed}
        return _norm(value) in allowed_norm

    # ── Auto-fix helpers ──────────────────────────────

    def auto_fix_allowed_value(self, char_name: str, invalid_value: str) -> Optional[str]:
        """
        Try to auto-fix an invalid value by finding the closest match in allowed values.
        Returns the corrected value from the allowed list, or None if no good match.
        """
        allowed = self.get_allowed_values(char_name) or []
        if not allowed:
            return None
        return find_best_match(invalid_value, allowed, threshold=0.72)

    def auto_fix_limit_violation(
        self, char_name: str, current_values: List[str], min_count: int, max_count: int,
    ) -> Optional[List[str]]:
        """
        Try to auto-fix a limit violation.
        - Too many values → trim to max_count (keep first N)
        - Too few values → suggest from allowed values to fill to min_count
        Returns the fixed list, or None if can't auto-fix.
        """
        count = len(current_values)
        if count > max_count > 0:
            # Trim to max
            return current_values[:max_count]
        if count < min_count:
            # Try to add from allowed values
            allowed = self.get_allowed_values(char_name) or []
            if not allowed:
                return None
            existing_norm = {_norm(v) for v in current_values}
            extras = [v for v in allowed if _norm(v) not in existing_norm]
            needed = min_count - count
            if len(extras) >= needed:
                return current_values + extras[:needed]
        return None


@dataclass
class ErrorReason:
    """Single error reason"""
    type: str  # "limit" | "allowed_values"
    message: str
    # For limit errors:
    min: Optional[int] = None
    max: Optional[int] = None
    actual: Optional[int] = None
    # For allowed_values errors:
    invalidValues: Optional[List[str]] = None
    exampleValues: Optional[List[str]] = None


@dataclass
class ValidationIssue:
    """Validation issue for a characteristic"""
    charcId: Optional[int]
    name: str
    value: Any
    message: str
    severity: str  # "critical" | "error" | "warning"
    category: str  # "limit" | "allowed_values" | "fixed_field" | etc.
    errors: List[ErrorReason]
    allowed_values: Optional[List[str]] = None
    suggested_value: Optional[Any] = None      # Auto-fix suggestion
    auto_fixed: bool = False                    # True if auto-fix is confident
    is_fixed_field: bool = False                # True if this is a WB fixed/system field


class CardValidator:
    """Validates WB cards against catalog rules"""
    
    def __init__(self, catalog: DataCatalog):
        self.catalog = catalog

    # Characteristics that exist in almost all clothing categories — skip "wrong_category" check
    _UNIVERSAL_CHAR_NAMES: Set[str] = {
        "состав", "цвет", "страна производства", "бренд", "sku", "артикул ozon",
        "тнвэд", "икпу", "ставка ндс", "код упаковки",
        "номер декларации соответствия", "номер сертификата соответствия",
        "дата регистрации сертификата/декларации",
        "дата окончания действия сертификата/декларации",
        "коллекция", "рос. размер", "размер",
        # Common clothing fields that appear in many (but not all) categories
        "пол", "комплектация", "рост модели на фото", "размер на модели",
        "тип ростовки", "особенности модели", "назначение", "уход за вещами",
        "декоративные элементы", "рисунок", "фактура материала",
        "параметры модели на фото (ог-от-об)", "параметры модели на фото",
    }

    def validate_card(
        self,
        card: Dict[str, Any],
        subject_id: Optional[int] = None,
    ) -> List[ValidationIssue]:
        """Validate a card and return list of issues"""
        out: List[ValidationIssue] = []
        chars = card.get("characteristics") or []
        sid = subject_id or card.get("subjectID") or card.get("subject_id")
        if isinstance(sid, str) and sid.isdigit():
            sid = int(sid)

        # Build set of valid characteristic names for this subject (for wrong_category check)
        valid_char_names: Optional[Set[str]] = None
        if sid:
            subject_chars = self.catalog.get_subject_chars(sid)
            if subject_chars:
                valid_char_names = {_norm(cm.name) for cm in subject_chars}

        for ch in chars:
            char_name = str(ch.get("name") or "").strip()
            char_id = ch.get("id")
            raw_value = ch.get("value")
            values = _as_list(raw_value)

            # Skip if no value (empty)
            if not values or all(str(v).strip() == "" for v in values):
                continue
            
            # Check if characteristic is fixed (cannot be changed)
            is_fixed = False
            if sid:
                char_meta = self.catalog.get_char_metadata(sid, char_name)
                if char_meta and char_meta.is_fixed:
                    is_fixed = True
                    # Check if there's an actual issue with this fixed field
                    issue = self._validate_one_characteristic(ch)
                    if issue is not None:
                        # Create a WARNING issue for fixed field
                        issue.severity = "warning"
                        issue.category = "fixed_field"
                        issue.is_fixed_field = True
                        issue.suggested_value = None  # Remove any auto-fix suggestions
                        issue.message = f"⚠️ FIXED FIELD: {char_name} — это системное поле WB, его нельзя изменить. {issue.message}"
                        out.append(issue)
                    continue
            
            # Skip characteristics marked as action=skip in charcs metadata
            if sid and self.catalog.should_skip_char(sid, char_name):
                continue

            # Check if characteristic belongs to this category at all
            if valid_char_names is not None:
                char_name_norm = _norm(char_name)
                if (char_name_norm not in valid_char_names
                        and char_name_norm not in self._UNIVERSAL_CHAR_NAMES):
                    out.append(ValidationIssue(
                        charcId=int(char_id) if isinstance(char_id, (int, str)) and str(char_id).isdigit() else None,
                        name=char_name,
                        value=raw_value,
                        message=(
                            f"Характеристика '{char_name}' не предусмотрена для категории "
                            f"'{card.get('subjectName', '')}' и должна быть удалена"
                        ),
                        severity="error",
                        category="wrong_category",
                        errors=[ErrorReason(
                            type="wrong_category",
                            message=(
                                f"Эта характеристика не входит в список допустимых "
                                f"характеристик для данной категории товара"
                            ),
                        )],
                        allowed_values=None,
                        suggested_value="__CLEAR__",
                        auto_fixed=False,
                        is_fixed_field=False,
                    ))
                    continue

            issue = self._validate_one_characteristic(ch)
            if issue is not None:
                out.append(issue)

        return out

    def _validate_one_characteristic(self, ch: Dict[str, Any]) -> Optional[ValidationIssue]:
        """Validate single characteristic and try to auto-fix"""
        char_id = ch.get("id")
        char_name = str(ch.get("name") or "").strip()
        raw_value = ch.get("value")
        values = _as_list(raw_value)

        reasons: List[ErrorReason] = []
        allowed_values: Optional[List[str]] = None
        suggested_value: Optional[Any] = None
        auto_fixed = False

        # 1) Check limits
        lim = self.catalog.get_limits(char_name)
        if lim:
            min_v = lim.get("min", 0)
            max_v = lim.get("max", 999)
            actual = len(values)
            if actual < min_v or actual > max_v:
                reasons.append(ErrorReason(
                    type="limit",
                    message=f"Количество значений ({actual}) вне допустимого диапазона ({min_v}-{max_v})",
                    min=min_v,
                    max=max_v,
                    actual=actual,
                ))
                # Try auto-fix limit
                fixed_list = self.catalog.auto_fix_limit_violation(
                    char_name,
                    [str(v) for v in values],
                    min_v, max_v,
                )
                if fixed_list is not None:
                    suggested_value = fixed_list if len(fixed_list) > 1 else fixed_list[0]
                    auto_fixed = True

        # 2) Check allowed values
        allowed = self.catalog.get_allowed_values(char_name)
        if allowed:
            if _norm(char_name) == "цвет":
                # For AI/UI keep compact parent-color list, not hundreds of shades.
                allowed_values = self.catalog.get_color_parent_names()
            else:
                allowed_values = allowed[:50]  # Limit for response
            allowed_norm = {_norm(x) for x in allowed}
            invalid = [v for v in values if _norm(str(v)) not in allowed_norm]
            if invalid:
                reasons.append(ErrorReason(
                    type="allowed_values",
                    message=f"Недопустимые значения: {', '.join(str(x) for x in invalid[:5])}",
                    invalidValues=invalid[:10],
                    exampleValues=allowed[:10],
                ))
                # Try auto-fix: find closest match for each invalid value
                fixed_values = list(values)  # copy
                all_matched = True
                for i, v in enumerate(fixed_values):
                    if _norm(str(v)) not in allowed_norm:
                        match = self.catalog.auto_fix_allowed_value(char_name, str(v))
                        if match:
                            fixed_values[i] = match
                        else:
                            all_matched = False
                if all_matched:
                    # All invalid values have matches
                    if len(fixed_values) == 1:
                        suggested_value = fixed_values[0]
                    else:
                        suggested_value = fixed_values
                    auto_fixed = True
                elif not auto_fixed:
                    # Partial matches — still suggest what we can
                    partial = []
                    for v in invalid:
                        match = self.catalog.auto_fix_allowed_value(char_name, str(v))
                        if match:
                            partial.append(f"{v} → {match}")
                    if partial:
                        suggested_value = "; ".join(partial)

        if not reasons:
            return None

        severity = "error"
        
        # Build message
        parts = []
        if any(r.type == "limit" for r in reasons):
            parts.append("превышен лимит")
        if any(r.type == "allowed_values" for r in reasons):
            parts.append("недопустимые значения")
        msg = f"Характеристика '{char_name}': {' + '.join(parts)}"

        # Determine category
        categories = [r.type for r in reasons]
        category = "+".join(sorted(set(categories)))

        return ValidationIssue(
            charcId=int(char_id) if isinstance(char_id, (int, str)) and str(char_id).isdigit() else None,
            name=char_name,
            value=raw_value,
            message=msg,
            severity=severity,
            category=category,
            errors=reasons,
            allowed_values=allowed_values,
            suggested_value=suggested_value,
            auto_fixed=auto_fixed,
        )


# Singleton catalog instance
_catalog: Optional[DataCatalog] = None


def get_catalog() -> DataCatalog:
    """Get or create catalog instance"""
    global _catalog
    if _catalog is None:
        _catalog = DataCatalog(settings.WB_DATA_ZIP_PATH)
    return _catalog


def get_validator() -> CardValidator:
    """Get validator instance"""
    return CardValidator(get_catalog())


def validate_card_characteristics(card: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Validate card characteristics against WB catalog.
    Returns list of issues with allowed_values and auto-fix suggestions.
    """
    validator = get_validator()
    subject_id = card.get("subjectID") or card.get("subject_id")
    issues = validator.validate_card(card, subject_id=subject_id)
    
    result = []
    for issue in issues:
        errors = [
            {
                "type": e.type,
                "message": e.message,
                "min": e.min,
                "max": e.max,
                "actual": e.actual,
                "invalidValues": e.invalidValues,
                "exampleValues": e.exampleValues,
            }
            for e in issue.errors
        ]
        # For wrong_category: inject fix_action=clear so frontend shows "clear" UI
        if issue.category == "wrong_category":
            errors.append({"type": "fix_action", "fix_action": "clear"})
        result.append({
            "charc_id": issue.charcId,
            "name": issue.name,
            "value": issue.value,
            "message": issue.message,
            "severity": issue.severity,
            "category": issue.category,
            "errors": errors,
            "allowed_values": issue.allowed_values,
            "suggested_value": issue.suggested_value,
            "auto_fixed": issue.auto_fixed,
            "is_fixed_field": issue.is_fixed_field,
        })
    return result
