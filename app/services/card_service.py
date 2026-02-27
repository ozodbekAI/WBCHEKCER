import asyncio
import re
from datetime import datetime
from typing import List, Optional
from sqlalchemy import select, update, delete, func, and_, String
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import Card, CardIssue, IssueSeverity, IssueCategory, IssueStatus
from ..services.analyzer import card_analyzer
from ..services.wb_validator import validate_card_characteristics, get_catalog, find_best_match
from ..services.gemini_service import get_gemini_service
from ..services import fixed_file_service as ffs

# Max retries for AI fix validation loop
MAX_FIX_RETRIES = 2

# ── Title quality validation ─────────────────────────────
_FORBIDDEN_COLORS = {
    "черный", "белый", "красный", "синий", "зеленый", "серый", "бежевый",
    "розовый", "голубой", "желтый", "коричневый", "фиолетовый", "оранжевый",
    "бордовый", "бирюзовый", "сиреневый", "малиновый", "салатовый",
    "персиковый", "лавандовый", "мятный", "хаки", "молочный", "айвори",
    "бордо", "индиго", "марсала", "пудровый", "графитовый", "шоколадный",
    "песочный", "кремовый", "изумрудный", "васильковый", "терракотовый",
    "мандариновый", "горчичный", "жемчужный", "пыльно-розовый",
}

_TITLE_CODES = {"title_too_short", "no_title", "title_too_long"}


def _validate_title_fix(title: str, card: dict) -> tuple:
    """
    Validate AI-generated title against WB quality rules.
    Returns (is_valid, fail_reason).
    """
    if not title or not isinstance(title, str):
        return False, "Пустое название"

    title = title.strip()

    # 1) Length
    if len(title) < 40:
        return False, f"Слишком короткое ({len(title)} символов, нужно 40-100)"
    if len(title) > 100:
        return False, f"Слишком длинное ({len(title)} символов, нужно 40-100)"

    # 2) No brand in title
    brand = (card.get("brand") or "").strip()
    if brand and len(brand) > 2 and brand.lower() in title.lower():
        return False, f"Содержит бренд '{brand}'. Бренд НЕ должен быть в названии."

    # 3) No color names — check against known basic colors
    title_lower = title.lower()
    title_words = set(re.findall(r'[а-яёa-z-]+', title_lower))
    found_colors = title_words & _FORBIDDEN_COLORS
    if found_colors:
        return False, (
            f"Содержит цвет: {', '.join(found_colors)}. "
            "Цвет указывается в характеристиках, НЕ в названии."
        )

    # Also check card's own color values
    chars = card.get("characteristics") or []
    for ch in (chars if isinstance(chars, list) else []):
        if isinstance(ch, dict) and "цвет" in (ch.get("name") or "").lower():
            color_vals = ch.get("value") or ch.get("values") or []
            if isinstance(color_vals, str):
                color_vals = [color_vals]
            if isinstance(color_vals, list):
                for cv in color_vals:
                    cv_str = str(cv).strip().lower()
                    # Only check single-word color names (avoid false positives)
                    if cv_str and len(cv_str) > 2 and " " not in cv_str:
                        if cv_str in title_words:
                            return False, (
                                f"Содержит цвет товара '{cv}'. "
                                "Цвет указывается в характеристиках, НЕ в названии."
                            )

    # 4) No "для + noun" — use adjectives instead
    m = re.search(r'\bдля\s+\w+', title_lower)
    if m:
        return False, (
            f"Содержит '{m.group()}'. Используй прилагательные "
            "(например 'офисный' вместо 'для офиса')."
        )

    return True, ""


async def sync_cards_from_wb(
    db: AsyncSession,
    store_id: int,
    wb_cards: List[dict],
) -> dict:
    """Sync cards from WB API to database"""
    result = {
        "new": 0,
        "updated": 0,
        "total": len(wb_cards),
    }
    
    for wb_card in wb_cards:
        nm_id = wb_card.get("nmID")
        if not nm_id:
            continue
        
        # Check if card exists
        existing = await db.execute(
            select(Card).where(Card.store_id == store_id, Card.nm_id == nm_id)
        )
        card = existing.scalar_one_or_none()
        
        # Extract card data from WB response
        card_data = _parse_wb_card(wb_card)
        
        if card:
            # Update existing
            for key, value in card_data.items():
                setattr(card, key, value)
            card.updated_at = datetime.utcnow()
            result["updated"] += 1
        else:
            # Create new
            card = Card(store_id=store_id, **card_data)
            db.add(card)
            result["new"] += 1
    
    await db.commit()
    return result


def _parse_wb_card(wb_card: dict) -> dict:
    """Parse WB API card response to our model format"""
    photos = wb_card.get("photos", [])
    videos = wb_card.get("videos", [])
    
    # Extract characteristics
    chars = {}
    for char in wb_card.get("characteristics", []):
        name = char.get("name", "")
        value = char.get("value", char.get("values", []))
        if value:
            chars[name] = value if not isinstance(value, list) else ", ".join(str(v) for v in value)
    
    # Extract dimensions
    dimensions = {}
    if wb_card.get("dimensions"):
        dim = wb_card["dimensions"]
        dimensions = {
            "length": dim.get("length"),
            "width": dim.get("width"),
            "height": dim.get("height"),
        }
    
    return {
        "nm_id": wb_card.get("nmID"),
        "imt_id": wb_card.get("imtID"),
        "vendor_code": wb_card.get("vendorCode"),
        "title": wb_card.get("title"),
        "brand": wb_card.get("brand"),
        "description": wb_card.get("description"),
        "subject_id": wb_card.get("subjectID"),
        "subject_name": wb_card.get("subjectName"),
        "category_name": wb_card.get("object"),  # WB uses "object" for category
        "photos": [p.get("big") for p in photos if p.get("big")],
        "videos": videos,
        "photos_count": len(photos),
        "videos_count": len(videos),
        "characteristics": chars,
        "dimensions": dimensions,
        "raw_data": wb_card,
    }


async def analyze_card(db: AsyncSession, card: Card, use_ai: bool = True) -> tuple:
    """
    Analyze a card and create issues with iterative AI fix loop.
    Returns (issues_list, token_usage_dict).
    
    Flow:
    1. Code validation (title, photos, description limits)
    2. WB catalog validation (allowed values + limits) with AUTO-FIX
    3. AI audit (Gemini — photo analysis, text mismatches)
    4. AI generates fixes for issues NOT auto-fixed by catalog
    5. Re-validate each AI fix against allowed_values/limits
    6. If fix doesn't pass → AI retries (up to MAX_FIX_RETRIES)
    7. Ensure every issue has a suggested_value
    8. Save everything to DB
    """
    # Token usage accumulator
    total_tokens = {"prompt_tokens": 0, "completion_tokens": 0, "thinking_tokens": 0, "total_tokens": 0, "api_calls": 0}

    def _add_tokens(t: dict):
        total_tokens["prompt_tokens"] += t.get("prompt_tokens", 0)
        total_tokens["completion_tokens"] += t.get("completion_tokens", 0)
        total_tokens["thinking_tokens"] += t.get("thinking_tokens", 0)
        total_tokens["total_tokens"] += t.get("total_tokens", 0)
        total_tokens["api_calls"] += 1
    # Delete old issues
    await db.execute(
        delete(CardIssue).where(CardIssue.card_id == card.id)
    )
    
    issues: List[CardIssue] = []
    raw_data = card.raw_data or {}
    
    # ── STEP 1: Basic code analysis ──────────────────────
    code_issues = card_analyzer.analyze_card(card)
    score_breakdown = card_analyzer.calculate_score(card, code_issues)
    
    for issue_data in code_issues:
        issue = CardIssue(
            card_id=card.id,
            code=issue_data["code"],
            severity=issue_data["severity"],
            category=issue_data["category"],
            title=issue_data["title"],
            description=issue_data["description"],
            current_value=str(issue_data.get("current_value")) if issue_data.get("current_value") else None,
            suggested_value=str(issue_data.get("suggested_value")) if issue_data.get("suggested_value") else None,
            alternatives=issue_data.get("alternatives", []),
            field_path=issue_data.get("field_path"),
            score_impact=issue_data["score_impact"],
            status=IssueStatus.PENDING,
            source="code",
        )
        db.add(issue)
        issues.append(issue)
    
    # ── STEP 2: WB catalog validation (characteristics) ──
    # Now includes auto-fix suggestions from catalog data
    wb_issues_data: List[dict] = []
    if raw_data:
        wb_issues_data = validate_card_characteristics(raw_data)
        
        for wb_issue in wb_issues_data:
            sv = wb_issue.get("suggested_value")
            is_fixed = wb_issue.get("is_fixed_field", False)
            
            # Agar fixed field bo'lsa, severity ni WARNING qilamiz
            severity = _map_severity(wb_issue.get("severity", "error"))
            if is_fixed:
                severity = IssueSeverity.WARNING
            
            issue = CardIssue(
                card_id=card.id,
                code=f"wb_fixed_{wb_issue.get('category', 'char')}" if is_fixed else f"wb_{wb_issue.get('category', 'char')}",
                severity=severity,
                category=IssueCategory.CHARACTERISTICS,
                title=wb_issue.get("message", "Ошибка характеристики"),
                description=_format_error_description(wb_issue),
                current_value=str(wb_issue.get("value")) if wb_issue.get("value") else None,
                # Fixed field don't get suggestions
                suggested_value=None if is_fixed else (_format_suggested(sv) if sv else None),
                field_path=f"characteristics.{wb_issue.get('name')}",
                charc_id=wb_issue.get("charc_id"),
                allowed_values=wb_issue.get("allowed_values", []),
                error_details=wb_issue.get("errors", []),
                score_impact=0 if is_fixed else _calculate_wb_score_impact(wb_issue),  # Fixed fields don't affect score
                status=IssueStatus.PENDING,
                source="code",
            )
            # Mark auto-fixed issues (but not if fixed field)
            if wb_issue.get("auto_fixed") and sv and not is_fixed:
                issue.source = "auto_fix"
            db.add(issue)
            issues.append(issue)

    # ── STEP 2.5: Fixed file check ────────────────────────
    # Compare card characteristics against store's uploaded fixed values.
    # Fixed file values always take priority — mismatch is a WARNING.
    nm_id = raw_data.get("nmID") or raw_data.get("nm_id") or getattr(card, "nm_id", None)
    if nm_id and raw_data:
        fixed_entries = await ffs.get_entries_for_card(db, card.store_id, nm_id)
        if fixed_entries:
            mismatches = ffs.compare_card_with_fixed(raw_data, fixed_entries)
            for mm in mismatches:
                ff_issue = CardIssue(
                    card_id=card.id,
                    code="fixed_file_mismatch",
                    severity=IssueSeverity.WARNING,
                    category=IssueCategory.CHARACTERISTICS,
                    title=f"Расхождение с эталонным файлом: {mm['char_name']}",
                    description=(
                        f"В эталонном файле: «{mm['fixed_value']}». "
                        f"В карточке: «{mm['card_value'] or 'не заполнено'}»."
                    ),
                    current_value=mm["card_value"],
                    suggested_value=mm["fixed_value"],
                    field_path=mm["field_path"],
                    score_impact=8,
                    status=IssueStatus.PENDING,
                    source="fixed_file",
                )
                db.add(ff_issue)
                issues.append(ff_issue)

    # ── STEP 3: AI audit (if enabled) ────────────────────
    gemini = get_gemini_service()
    if use_ai and gemini.is_enabled() and raw_data:
        # Enrich raw_data with valid characteristic names for this category
        # so AI knows which characteristics belong to this category
        audit_data = dict(raw_data)
        subject_id = raw_data.get("subjectID") or raw_data.get("subject_id")
        if subject_id:
            catalog = get_catalog()
            subject_chars = catalog.get_subject_chars(int(subject_id))
            if subject_chars:
                audit_data["_valid_char_names"] = [cm.name for cm in subject_chars]
        ai_issues, audit_tokens = await asyncio.to_thread(gemini.audit_card, audit_data)
        _add_tokens(audit_tokens)
        
        for ai_issue in ai_issues:
            # Build error_details with swap/compound info if present
            ai_error_details = ai_issue.get("errors", [])
            fix_action = ai_issue.get("fix_action", "replace")
            if fix_action == "compound":
                compound_fixes = ai_issue.get("compound_fixes", [])
                if compound_fixes:
                    ai_error_details = list(ai_error_details or [])
                    # Build name → current value map so each sub-field can show its "before" state
                    chars_raw = raw_data.get("characteristics") or []
                    _char_val_map: dict = {}
                    for _ch in (chars_raw if isinstance(chars_raw, list) else []):
                        _n = (_ch.get("name") or "").lower()
                        _v = _ch.get("value") or _ch.get("values")
                        if _n:
                            _char_val_map[_n] = (
                                ", ".join(str(x) for x in _v)
                                if isinstance(_v, list)
                                else (str(_v) if _v is not None else None)
                            )
                    ai_error_details.append({
                        "type": "compound",
                        "fix_action": "compound",
                        "fixes": [
                            {
                                "name": f.get("name", ""),
                                "field_path": f"characteristics.{f.get('name', '')}",
                                "charc_id": f.get("charcId"),
                                "action": f.get("action", "set"),
                                "value": f.get("value"),
                                "current_value": _char_val_map.get((f.get("name") or "").lower()),
                            }
                            for f in compound_fixes
                        ],
                    })
            elif fix_action == "swap":
                ai_error_details = ai_error_details or []
                ai_error_details.append({
                    "type": "swap",
                    "fix_action": "swap",
                    "swap_to_name": ai_issue.get("swap_to_name", ""),
                    "swap_to_value": ai_issue.get("swap_to_value", ""),
                })
            elif fix_action == "clear":
                ai_error_details = ai_error_details or []
                ai_error_details.append({
                    "type": "clear",
                    "fix_action": "clear",
                })

            issue = CardIssue(
                card_id=card.id,
                code=f"ai_{ai_issue.get('category', 'mixed')}",
                severity=_map_severity(ai_issue.get("severity", "warning")),
                category=_map_ai_category(ai_issue.get("category")),
                title=ai_issue.get("message", "AI обнаружил проблему"),
                description=_format_ai_description(ai_issue),
                current_value=str(ai_issue.get("value")) if ai_issue.get("value") else None,
                field_path=f"characteristics.{ai_issue.get('name')}" if ai_issue.get("name") else None,
                charc_id=ai_issue.get("charcId"),
                error_details=ai_error_details,
                score_impact=_calculate_ai_score_impact(ai_issue),
                status=IssueStatus.PENDING,
                source="ai",
            )
            db.add(issue)
            issues.append(issue)
        
        # ── STEP 4: AI generates fixes ──────────────────
        # Send ALL issues to AI for concrete fixes, except:
        #   - Photo/video issues (need manual upload)
        #   - Auto-fixed issues (already have correct values)
        _SKIP_AI_CODES = {
            "no_photos", "few_photos", "add_more_photos",
            "no_video",
        }
        _AI_TEXT_CODES = {
            "title_too_short", "no_title", "title_too_long",
            "no_description", "description_too_short",
        }
        fixable_issues = []
        fixable_indices = []
        for idx, iss in enumerate(issues):
            already_auto_fixed = (iss.source == "auto_fix")
            is_skip = iss.code in _SKIP_AI_CODES
            # wrong_category issues already have __CLEAR__ as suggested_value — no AI needed
            is_wrong_category = iss.code == "wb_wrong_category"
            
            # Send to AI: everything except photo/video, auto-fixed, and wrong_category
            if not is_skip and not already_auto_fixed and not is_wrong_category:
                fixable_issues.append({
                    "id": str(idx),
                    "name": iss.field_path or iss.title,
                    "current_value": iss.current_value,
                    "error_type": iss.code,
                    "message": iss.title,
                    "description": iss.description,
                    "allowed_values": iss.allowed_values,
                    "errors": iss.error_details,
                })
                fixable_indices.append(idx)
                # Clear analyzer's generic suggested_value — AI will provide concrete one
                iss.suggested_value = None
        
        if fixable_issues:
            suggestions, fixes_tokens = await asyncio.to_thread(gemini.generate_fixes, raw_data, fixable_issues)
            _add_tokens(fixes_tokens)
            
            # ── STEP 5–6: Validate each fix, retry if needed ──
            missed_issues = []  # Issues AI didn't return fixes for
            for fi_pos, idx in enumerate(fixable_indices):
                iss = issues[idx]
                suggestion = suggestions.get(str(idx), {})
                if not suggestion:
                    missed_issues.append((idx, fixable_issues[fi_pos]))
                    continue

                rec_value = suggestion.get("recommended_value")
                reason = suggestion.get("reason", "")

                is_title_issue = iss.code in _TITLE_CODES
                is_text_issue = iss.code in _AI_TEXT_CODES

                # ── A) Title issues — validate against quality rules ──
                if is_title_issue and rec_value:
                    fix_valid, fail_reason = _validate_title_fix(
                        str(rec_value), raw_data
                    )
                    if not fix_valid:
                        for retry in range(MAX_FIX_RETRIES):
                            refix, refix_t = await asyncio.to_thread(
                                gemini.refix_title,
                                card=raw_data,
                                current_title=str(rec_value),
                                failed_reason=fail_reason,
                            )
                            _add_tokens(refix_t)
                            if not refix:
                                break
                            rec_value = refix.get("recommended_value", rec_value)
                            reason = refix.get("reason", reason)
                            fix_valid, fail_reason = _validate_title_fix(
                                str(rec_value), raw_data
                            )
                            if fix_valid:
                                break

                # ── B) Characteristic issues — validate against allowed values ──
                elif not is_text_issue and (iss.allowed_values or iss.error_details):
                    fix_valid, fail_reason, corrected_value = _validate_fix_against_constraints(
                        rec_value, iss.allowed_values, iss.error_details
                    )
                    
                    # If fuzzy match found a better value, use it immediately
                    if corrected_value is not None:
                        rec_value = corrected_value
                        reason = f"{reason} (автоматически скорректировано до ближайшего допустимого значения)"

                    if not fix_valid:
                        # Retry loop
                        for retry in range(MAX_FIX_RETRIES):
                            refix, refix_t = await asyncio.to_thread(
                                gemini.refix_value,
                                card=raw_data,
                                char_name=iss.field_path or iss.title,
                                current_value=rec_value,
                                failed_reason=fail_reason,
                                allowed_values=iss.allowed_values or [],
                                limits=_extract_limits(iss.error_details),
                            )
                            _add_tokens(refix_t)
                            if not refix:
                                break
                            rec_value = refix.get("recommended_value", rec_value)
                            reason = refix.get("reason", reason)

                            fix_valid, fail_reason, corrected_value = _validate_fix_against_constraints(
                                rec_value, iss.allowed_values, iss.error_details
                            )
                            
                            # Apply fuzzy match correction if found
                            if corrected_value is not None:
                                rec_value = corrected_value
                                reason = f"{reason} (автоматически скорректировано)"
                            
                            if fix_valid:
                                break

                # Save the fix — skip empty AI results
                # For swap actions: empty recommended_value is valid (means "clear this field")
                fix_action = suggestion.get("fix_action", "replace")
                is_swap = fix_action == "swap"
                is_clear = fix_action == "clear"

                has_value = rec_value is not None and rec_value != "" and rec_value != []
                
                if is_swap or is_clear:
                    # For swap/clear: the recommended_value should be "" (clear)
                    iss.ai_suggested_value = ""
                    iss.suggested_value = ""
                    # Store swap info in error_details
                    swap_details = list(iss.error_details or [])
                    swap_entry = {"type": "swap" if is_swap else "clear", "fix_action": fix_action}
                    if is_swap:
                        swap_entry["swap_to_name"] = suggestion.get("swap_to_name", "")
                        swap_entry["swap_to_value"] = suggestion.get("swap_to_value", "")
                    # Remove existing swap/clear entries to avoid duplicates
                    swap_details = [d for d in swap_details if d.get("fix_action") not in ("swap", "clear")]
                    swap_details.append(swap_entry)
                    iss.error_details = swap_details
                elif has_value:
                    iss.ai_suggested_value = _format_suggested(rec_value)
                else:
                    iss.ai_suggested_value = None
                    
                iss.ai_reason = reason
                iss.ai_alternatives = []

                # Always use AI concrete value as suggested_value
                if has_value and not is_swap and not is_clear:
                    iss.suggested_value = _format_suggested(rec_value)

            # ── STEP 5b: Retry missed issues (AI didn't return fix) ──
            if missed_issues:
                retry_issues = []
                retry_map = []  # (original_idx, position_in_retry)
                for orig_idx, issue_data in missed_issues:
                    retry_issues.append({
                        **issue_data,
                        "id": "0",  # Single issue per retry
                    })
                    retry_map.append(orig_idx)

                for ri, retry_issue in enumerate(retry_issues):
                    orig_idx = retry_map[ri]
                    iss = issues[orig_idx]
                    retry_result, retry_t = await asyncio.to_thread(
                        gemini.generate_fixes, raw_data, [retry_issue]
                    )
                    _add_tokens(retry_t)
                    suggestion = retry_result.get("0", {})
                    if suggestion:
                        rec_value = suggestion.get("recommended_value")
                        reason = suggestion.get("reason", "")
                        has_value = rec_value is not None and rec_value != "" and rec_value != []
                        if has_value:
                            iss.ai_suggested_value = _format_suggested(rec_value)
                            iss.ai_reason = reason
                            iss.ai_alternatives = []
                            iss.suggested_value = _format_suggested(rec_value)
    
    # ── STEP 7: Ensure every issue has a suggested_value ─
    _ensure_all_suggested_values(issues)
    
    # ── STEP 8: Update card score and counts ─────────────
    card.score = score_breakdown["total_score"]
    card.score_breakdown = score_breakdown
    card.critical_issues_count = sum(1 for i in issues if i.severity == IssueSeverity.CRITICAL)
    card.warnings_count = sum(1 for i in issues if i.severity == IssueSeverity.WARNING)
    card.improvements_count = sum(1 for i in issues if i.severity == IssueSeverity.IMPROVEMENT)
    card.last_analysis_at = datetime.utcnow()
    
    await db.commit()
    return issues, total_tokens


def _format_suggested(value) -> str:
    """Format a suggested value (list or scalar) to string"""
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    return str(value)


def _ensure_all_suggested_values(issues: List[CardIssue]) -> None:
    """
    Make sure every issue has a suggested_value.
    AI should have filled most issues. This handles fallback when AI is unavailable.
    IMPORTANT: Never use advice text as suggested_value — always provide concrete ready values.
    """
    for iss in issues:
        if iss.suggested_value is not None:
            continue  # Already has concrete suggestion (including "" for swap/clear)

        # Try AI value
        if iss.ai_suggested_value:
            iss.suggested_value = iss.ai_suggested_value
            continue

        code = iss.code or ""

        # Photo/video issues — manual action needed, provide instructions
        if code in ("no_photos",):
            iss.suggested_value = "Загрузите минимум 3 фотографии товара"
            continue
        if code in ("few_photos",):
            iss.suggested_value = "Добавьте фотографии до рекомендуемого количества (5-7 фото)"
            continue
        if code in ("add_more_photos",):
            iss.suggested_value = "Добавьте 7-10 фото: общий вид, детали, на модели"
            continue
        if code in ("no_video",):
            iss.suggested_value = "Добавьте видео 15-30 секунд для повышения конверсии"
            continue

        # Fixed field issues — cannot be changed, just inform
        if code.startswith("wb_fixed_"):
            iss.suggested_value = "⚠️ Это системное поле WB, изменить нельзя"
            continue

        # For text issues where AI failed — leave empty, don't put advice as value
        # The frontend should show "AI недоступен" instead
        # Do NOT use iss.description as suggested_value — it's advice, not a value!
        iss.suggested_value = None


def _validate_fix_against_constraints(
    value,
    allowed_values: list,
    error_details: list,
) -> tuple:
    """
    Check if AI-suggested value passes allowed_values and limit constraints.
    Returns (is_valid: bool, fail_reason: str, corrected_value: any)
    
    If value doesn't match allowed_values exactly, tries to find best match.
    """
    corrected = None
    
    if not allowed_values and not error_details:
        return True, "", None
    
    # Check allowed_values
    if allowed_values:
        if isinstance(value, list):
            corrected_list = []
            invalid = []
            for v in value:
                v_str = str(v).strip()
                # Try exact match
                if v_str in allowed_values:
                    corrected_list.append(v_str)
                else:
                    # Try fuzzy match
                    best_match = find_best_match(v_str, allowed_values, threshold=0.75)
                    if best_match:
                        corrected_list.append(best_match)
                    else:
                        invalid.append(v_str)
            
            if invalid:
                return False, f"Значения {invalid} отсутствуют в допустимых: {allowed_values[:10]}", None
            if corrected_list != value:
                corrected = corrected_list
        
        elif isinstance(value, str):
            v_str = value.strip()
            # Try exact match
            if v_str not in allowed_values:
                # Try fuzzy match
                best_match = find_best_match(v_str, allowed_values, threshold=0.75)
                if best_match:
                    corrected = best_match
                else:
                    return False, f"Значение '{v_str}' отсутствует в допустимых: {allowed_values[:10]}", None
    
    # Check limits
    limits = _extract_limits(error_details)
    if limits:
        min_l = limits.get("min")
        max_l = limits.get("max")
        if isinstance(value, list):
            count = len(value)
        elif isinstance(value, str) and "," in value:
            count = len([v.strip() for v in value.split(",") if v.strip()])
        else:
            count = 1
        
        if min_l is not None and count < min_l:
            return False, f"Нужно минимум {min_l} значений, сейчас {count}", corrected
        if max_l is not None and count > max_l:
            return False, f"Нужно максимум {max_l} значений, сейчас {count}", corrected
    
    return True, "", corrected


def _extract_limits(error_details: list) -> dict:
    """Extract min/max limits from error_details"""
    if not error_details:
        return {}
    for err in error_details:
        if isinstance(err, dict) and err.get("type") == "limit":
            return {"min": err.get("min"), "max": err.get("max")}
    return {}


def _map_severity(severity: str) -> IssueSeverity:
    """Map string severity to enum"""
    mapping = {
        "critical": IssueSeverity.CRITICAL,
        "error": IssueSeverity.WARNING,
        "warning": IssueSeverity.WARNING,
        "info": IssueSeverity.INFO,
    }
    return mapping.get(severity.lower(), IssueSeverity.WARNING)


def _map_ai_category(category: str) -> IssueCategory:
    """Map AI category to enum"""
    mapping = {
        "photo": IssueCategory.PHOTOS,
        "text": IssueCategory.DESCRIPTION,
        "identification": IssueCategory.CATEGORY,
        "qualification": IssueCategory.CHARACTERISTICS,
        "mixed": IssueCategory.OTHER,
    }
    return mapping.get(category.lower(), IssueCategory.OTHER) if category else IssueCategory.OTHER


def _format_error_description(wb_issue: dict) -> str:
    """Format WB validation error description"""
    parts = []
    for err in wb_issue.get("errors", []):
        if err.get("type") == "limit":
            parts.append(f"Лимит: {err.get('min', 0)}-{err.get('max', 999)}, текущее: {err.get('actual')}")
        elif err.get("type") == "allowed_values":
            invalid = err.get("invalidValues", [])[:3]
            if invalid:
                parts.append(f"Недопустимые значения: {', '.join(str(x) for x in invalid)}")
        elif err.get("type") == "wrong_category":
            parts.append(err.get("message", "Характеристика не входит в список допустимых для данной категории"))
    return "; ".join(parts) if parts else wb_issue.get("message", "")


def _format_ai_description(ai_issue: dict) -> str:
    """Format AI issue description"""
    parts = []
    for err in ai_issue.get("errors", []):
        parts.append(f"{err.get('type', 'issue')}: {err.get('message', '')}")
    return "; ".join(parts) if parts else ai_issue.get("message", "")


def _calculate_wb_score_impact(wb_issue: dict) -> int:
    """Calculate score impact for WB validation issue"""
    errors = wb_issue.get("errors", [])
    # Wrong category characteristics are a significant quality issue
    if any(e.get("type") == "wrong_category" for e in errors):
        return 10
    base = 8
    if any(e.get("type") == "limit" for e in errors):
        base += 4
    if any(e.get("type") == "allowed_values" for e in errors):
        base += 2
    return min(base, 15)


def _calculate_ai_score_impact(ai_issue: dict) -> int:
    """Calculate score impact for AI issue"""
    severity_scores = {
        "critical": 12,
        "error": 8,
        "warning": 5,
    }
    return severity_scores.get(ai_issue.get("severity", "warning"), 5)


async def analyze_store_cards(
    db: AsyncSession,
    store_id: int,
    use_ai: bool = True,
    limit: Optional[int] = 10,  # Default 10 cards for testing
) -> dict:
    """Analyze cards in a store. If limit is set, only analyze that many."""
    query = select(Card).where(Card.store_id == store_id)
    if limit:
        query = query.limit(limit)
    result = await db.execute(query)
    cards = result.scalars().all()
    
    total = len(cards)
    analyzed = 0
    total_issues = 0
    analyzed_ids = []
    
    for card in cards:
        issues, _tokens = await analyze_card(db, card, use_ai=use_ai)
        analyzed += 1
        total_issues += len(issues)
        analyzed_ids.append(card.id)
    
    # Reset stale counts for non-analyzed cards in this store
    # (cards not in the batch may have outdated counts with no matching issues)
    if limit and analyzed_ids:
        await db.execute(
            update(Card)
            .where(
                Card.store_id == store_id,
                Card.id.notin_(analyzed_ids),
            )
            .values(
                critical_issues_count=0,
                warnings_count=0,
                improvements_count=0,
                growth_points_count=0,
            )
        )
        # Also delete orphaned issues for non-analyzed cards
        await db.execute(
            delete(CardIssue)
            .where(
                CardIssue.card_id.in_(
                    select(Card.id).where(
                        Card.store_id == store_id,
                        Card.id.notin_(analyzed_ids),
                    )
                )
            )
        )
        await db.commit()
    
    return {
        "total": total,
        "analyzed": analyzed,
        "issues_found": total_issues,
    }


async def get_card_by_id(db: AsyncSession, card_id: int) -> Optional[Card]:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Card)
        .options(selectinload(Card.issues))
        .where(Card.id == card_id)
    )
    return result.scalar_one_or_none()


async def get_store_cards(
    db: AsyncSession,
    store_id: int,
    skip: int = 0,
    limit: int = 50,
    search: Optional[str] = None,
    min_score: Optional[int] = None,
    max_score: Optional[int] = None,
    has_critical: Optional[bool] = None,
) -> tuple[List[Card], int]:
    """Get cards with filters"""
    query = select(Card).where(Card.store_id == store_id)
    count_query = select(func.count(Card.id)).where(Card.store_id == store_id)
    
    if search:
        search_filter = f"%{search}%"
        query = query.where(
            (Card.title.ilike(search_filter)) |
            (Card.vendor_code.ilike(search_filter)) |
            (func.cast(Card.nm_id, String).ilike(search_filter))
        )
        count_query = count_query.where(
            (Card.title.ilike(search_filter)) |
            (Card.vendor_code.ilike(search_filter))
        )
    
    if min_score is not None:
        query = query.where(Card.score >= min_score)
        count_query = count_query.where(Card.score >= min_score)
    
    if max_score is not None:
        query = query.where(Card.score <= max_score)
        count_query = count_query.where(Card.score <= max_score)
    
    if has_critical is not None:
        if has_critical:
            query = query.where(Card.critical_issues_count > 0)
            count_query = count_query.where(Card.critical_issues_count > 0)
        else:
            query = query.where(Card.critical_issues_count == 0)
            count_query = count_query.where(Card.critical_issues_count == 0)
    
    # Get total count
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0
    
    # Get paginated results
    query = query.order_by(Card.critical_issues_count.desc(), Card.score.asc())
    query = query.offset(skip).limit(limit)
    
    result = await db.execute(query)
    cards = list(result.scalars().all())
    
    return cards, total


async def get_card_by_nm_id(db: AsyncSession, nm_id: int, store_id: int) -> Optional[Card]:
    """Get a card by WB nmID within a store."""
    result = await db.execute(
        select(Card).where(Card.nm_id == nm_id, Card.store_id == store_id)
    )
    return result.scalar_one_or_none()
