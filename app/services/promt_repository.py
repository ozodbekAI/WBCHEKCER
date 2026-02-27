from typing import Optional, List
from sqlalchemy.orm import Session
from datetime import datetime

from app.models.promt import PromptTemplate, PromptVersion


class PromptRepository:
    """Repository for managing prompt templates"""

    def __init__(self, db: Session):
        self.db = db

    def get_active_prompt(self, prompt_type: str) -> Optional[PromptTemplate]:
        return (
            self.db.query(PromptTemplate)
            .filter(
                PromptTemplate.prompt_type == prompt_type,
                PromptTemplate.is_active == True,
            )
            .first()
        )

    def get_prompt_by_type(self, prompt_type: str) -> Optional[PromptTemplate]:
        """Faol / nofaol bo‘lishidan qat’i nazar promptni olib kelish"""
        return (
            self.db.query(PromptTemplate)
            .filter(PromptTemplate.prompt_type == prompt_type)
            .first()
        )

    def get_all_prompts(self) -> List[PromptTemplate]:
        return self.db.query(PromptTemplate).all()

    def create_prompt(
        self,
        prompt_type: str,
        system_prompt: str,
        strict_rules: Optional[str] = None,
        examples: Optional[str] = None,
        created_by_id: Optional[int] = None,
        created_by_username: Optional[str] = None,
    ) -> PromptTemplate:
        """
        Yangi prompt yaratish:
        - PromptTemplate (asosiy jadval)
        - PromptVersion (tarix)
        """

        prompt = PromptTemplate(
            prompt_type=prompt_type,
            system_prompt=system_prompt,
            strict_rules=strict_rules,
            examples=examples,
            created_by_id=created_by_id,
            version=1,
            is_active=True,
        )
        self.db.add(prompt)
        self.db.flush()  # ID olish uchun

        # Versiya tarixini saqlaymiz
        version = PromptVersion(
            prompt_template_id=prompt.id,
            system_prompt=prompt.system_prompt,
            strict_rules=prompt.strict_rules,
            examples=prompt.examples,
            version=prompt.version,
            created_by=created_by_username,
            change_reason="Initial creation",
        )
        self.db.add(version)

        self.db.commit()
        self.db.refresh(prompt)
        return prompt

    def update_prompt(
        self,
        prompt_type: str,
        system_prompt: Optional[str] = None,
        strict_rules: Optional[str] = None,
        examples: Optional[str] = None,
        updated_by_username: Optional[str] = None,
        change_reason: Optional[str] = None,
    ) -> PromptTemplate:
        """
        Mavjud aktiv promptni yangilash:
        - PromptTemplate versiyasini ++
        - Yangi PromptVersion qo'shish

        MUHIM:
        - strict_rules = "" yuborilsa -> bazada ham "" bo‘ladi (oldingi qiymat o‘chadi)
        - strict_rules = None yuborilsa -> maydon o‘zgarmaydi
        """
        prompt = self.get_active_prompt(prompt_type)
        if not prompt:
            raise ValueError(f"Prompt type '{prompt_type}' not found")

        if system_prompt is not None:
            prompt.system_prompt = system_prompt
        if strict_rules is not None:
            # bo'sh string bo'lsa ham yozib qo'yamiz (clearing)
            prompt.strict_rules = strict_rules
        if examples is not None:
            prompt.examples = examples

        prompt.version += 1
        prompt.updated_at = datetime.utcnow()

        self.db.flush()

        version = PromptVersion(
            prompt_template_id=prompt.id,
            system_prompt=prompt.system_prompt,
            strict_rules=prompt.strict_rules,
            examples=prompt.examples,
            version=prompt.version,
            created_by=updated_by_username,
            change_reason=change_reason,
        )
        self.db.add(version)

        self.db.commit()
        self.db.refresh(prompt)
        return prompt

    def set_prompt_active(self, prompt_type: str, is_active: bool) -> PromptTemplate:
        """
        Promptni aktiv / nofaol qilish.
        """
        prompt = self.get_prompt_by_type(prompt_type)
        if not prompt:
            raise ValueError(f"Prompt type '{prompt_type}' not found")

        prompt.is_active = is_active
        prompt.updated_at = datetime.utcnow()

        self.db.commit()
        self.db.refresh(prompt)
        return prompt

    def get_prompt_versions(self, prompt_type: str) -> List[PromptVersion]:
        prompt = self.get_prompt_by_type(prompt_type)
        if not prompt:
            return []

        return (
            self.db.query(PromptVersion)
            .filter(PromptVersion.prompt_template_id == prompt.id)
            .order_by(PromptVersion.version.desc())
            .all()
        )
