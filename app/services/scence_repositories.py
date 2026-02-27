# backend/repositories/scence_repositories.py

from sqlalchemy.orm import Session
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from typing import Optional, List, Dict

from app.models.generator import (
    PoseGroup,
    PoseSubgroup,
    PosePrompt,
    SceneCategory,
    SceneSubcategory,
    SceneItem,
)


class PoseRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_all_groups(self) -> List[PoseGroup]:
        result = self.session.execute(
            select(PoseGroup)
            .where(PoseGroup.is_active == True)
            .order_by(PoseGroup.order_index)
        )
        return list(result.scalars().all())

    def get_group(self, group_id: int) -> Optional[PoseGroup]:
        result = self.session.execute(
            select(PoseGroup).where(PoseGroup.id == group_id)
        )
        return result.scalar_one_or_none()

    def add_group(self, name: str, order_index: int = 0) -> PoseGroup:
        group = PoseGroup(name=name, order_index=order_index)
        self.session.add(group)
        self.session.commit()
        self.session.refresh(group)
        return group

    def delete_group(self, group_id: int):
        self.session.execute(
            delete(PoseGroup).where(PoseGroup.id == group_id)
        )
        self.session.commit()

    def get_subgroups_by_group(self, group_id: int) -> List[PoseSubgroup]:
        result = self.session.execute(
            select(PoseSubgroup)
            .where(
                PoseSubgroup.group_id == group_id,
                PoseSubgroup.is_active == True,
            )
            .order_by(PoseSubgroup.order_index)
        )
        return list(result.scalars().all())

    def get_subgroup(self, subgroup_id: int) -> Optional[PoseSubgroup]:
        result = self.session.execute(
            select(PoseSubgroup).where(PoseSubgroup.id == subgroup_id)
        )
        return result.scalar_one_or_none()

    def add_subgroup(self, group_id: int, name: str, order_index: int = 0) -> PoseSubgroup:
        subgroup = PoseSubgroup(
            group_id=group_id,
            name=name,
            order_index=order_index,
        )
        self.session.add(subgroup)
        self.session.commit()
        self.session.refresh(subgroup)
        return subgroup

    def delete_subgroup(self, subgroup_id: int):
        self.session.execute(
            delete(PoseSubgroup).where(PoseSubgroup.id == subgroup_id)
        )
        self.session.commit()

    def get_prompts_by_subgroup(self, subgroup_id: int) -> List[PosePrompt]:
        result = self.session.execute(
            select(PosePrompt)
            .where(
                PosePrompt.subgroup_id == subgroup_id,
                PosePrompt.is_active == True,
            )
            .order_by(PosePrompt.order_index)
        )
        return list(result.scalars().all())

    def get_prompt(self, prompt_id: int) -> Optional[PosePrompt]:
        result = self.session.execute(
            select(PosePrompt).where(PosePrompt.id == prompt_id)
        )
        return result.scalar_one_or_none()

    def add_prompt(
        self,
        subgroup_id: int,
        name: str,
        prompt: str,
        order_index: int = 0,
    ) -> PosePrompt:
        pose_prompt = PosePrompt(
            subgroup_id=subgroup_id,
            name=name,
            prompt=prompt,
            order_index=order_index,
        )
        self.session.add(pose_prompt)
        self.session.commit()
        self.session.refresh(pose_prompt)
        return pose_prompt

    def update_prompt(self, prompt_id: int, name: str, prompt: str) -> Optional[PosePrompt]:
        result = self.session.execute(
            select(PosePrompt).where(PosePrompt.id == prompt_id)
        )
        pose_prompt = result.scalar_one_or_none()
        if pose_prompt:
            pose_prompt.name = name
            pose_prompt.prompt = prompt
            self.session.commit()
            self.session.refresh(pose_prompt)
        return pose_prompt

    def delete_prompt(self, prompt_id: int):
        self.session.execute(
            delete(PosePrompt).where(PosePrompt.id == prompt_id)
        )
        self.session.commit()

    def get_full_hierarchy(self) -> Dict:
        result = self.session.execute(
            select(PoseGroup)
            .options(
                selectinload(PoseGroup.subgroups).selectinload(
                    PoseSubgroup.prompts
                )
            )
            .where(PoseGroup.is_active == True)
            .order_by(PoseGroup.order_index)
        )
        groups = result.scalars().all()

        hierarchy: Dict[int, Dict] = {}
        for group in groups:
            hierarchy[group.id] = {
                "name": group.name,
                "subgroups": {},
            }

            for subgroup in group.subgroups:
                if not subgroup.is_active:
                    continue
                hierarchy[group.id]["subgroups"][subgroup.id] = {
                    "name": subgroup.name,
                    "prompts": [
                        {
                            "id": p.id,
                            "name": p.name,
                            "prompt": p.prompt,
                        }
                        for p in subgroup.prompts
                        if p.is_active
                    ],
                }

        return hierarchy

    def search_prompts_by_keyword(self, keyword: str) -> List[PosePrompt]:
        """Keyword bo'yicha pose prompt'larni qidirish"""
        keyword_lower = keyword.lower()
        result = self.session.execute(
            select(PosePrompt)
            .where(
                PosePrompt.is_active == True,
                (
                    PosePrompt.name.ilike(f"%{keyword_lower}%") |
                    PosePrompt.prompt.ilike(f"%{keyword_lower}%")
                )
            )
            .limit(10)
        )
        return list(result.scalars().all())


class SceneCategoryRepository:
    def __init__(self, session: Session):
        self.session = session

    def get_all_categories(self) -> List[SceneCategory]:
        result = self.session.execute(
            select(SceneCategory)
            .where(SceneCategory.is_active == True)
            .order_by(SceneCategory.order_index)
        )
        return list(result.scalars().all())

    def get_category(self, category_id: int) -> Optional[SceneCategory]:
        result = self.session.execute(
            select(SceneCategory).where(SceneCategory.id == category_id)
        )
        return result.scalar_one_or_none()

    def add_category(self, name: str, order_index: int = 0) -> SceneCategory:
        category = SceneCategory(name=name, order_index=order_index)
        self.session.add(category)
        self.session.commit()
        self.session.refresh(category)
        return category

    def delete_category(self, category_id: int):
        self.session.execute(
            delete(SceneCategory).where(SceneCategory.id == category_id)
        )
        self.session.commit()

    def get_subcategories_by_category(self, category_id: int) -> List[SceneSubcategory]:
        result = self.session.execute(
            select(SceneSubcategory)
            .where(
                SceneSubcategory.category_id == category_id,
                SceneSubcategory.is_active == True,
            )
            .order_by(SceneSubcategory.order_index)
        )
        return list(result.scalars().all())

    def get_subcategory(self, subcategory_id: int) -> Optional[SceneSubcategory]:
        result = self.session.execute(
            select(SceneSubcategory).where(SceneSubcategory.id == subcategory_id)
        )
        return result.scalar_one_or_none()

    def add_subcategory(
        self,
        category_id: int,
        name: str,
        order_index: int = 0,
    ) -> SceneSubcategory:
        subcategory = SceneSubcategory(
            category_id=category_id,
            name=name,
            order_index=order_index,
        )
        self.session.add(subcategory)
        self.session.commit()
        self.session.refresh(subcategory)
        return subcategory

    def delete_subcategory(self, subcategory_id: int):
        self.session.execute(
            delete(SceneSubcategory).where(
                SceneSubcategory.id == subcategory_id
            )
        )
        self.session.commit()

    def get_items_by_subcategory(self, subcategory_id: int) -> List[SceneItem]:
        result = self.session.execute(
            select(SceneItem)
            .where(
                SceneItem.subcategory_id == subcategory_id,
                SceneItem.is_active == True,
            )
            .order_by(SceneItem.order_index)
        )
        return list(result.scalars().all())

    def get_item(self, item_id: int) -> Optional[SceneItem]:
        result = self.session.execute(
            select(SceneItem).where(SceneItem.id == item_id)
        )
        return result.scalar_one_or_none()

    def add_item(
        self,
        subcategory_id: int,
        name: str,
        prompt: str,
        order_index: int = 0,
    ) -> SceneItem:
        item = SceneItem(
            subcategory_id=subcategory_id,
            name=name,
            prompt=prompt,
            order_index=order_index,
        )
        self.session.add(item)
        self.session.commit()
        self.session.refresh(item)
        return item

    def update_item(self, item_id: int, name: str, prompt: str) -> Optional[SceneItem]:
        result = self.session.execute(
            select(SceneItem).where(SceneItem.id == item_id)
        )
        item = result.scalar_one_or_none()
        if item:
            item.name = name
            item.prompt = prompt
            self.session.commit()
            self.session.refresh(item)
        return item

    def delete_item(self, item_id: int):
        self.session.execute(
            delete(SceneItem).where(SceneItem.id == item_id)
        )
        self.session.commit()

    def get_full_hierarchy(self) -> Dict:
        result = self.session.execute(
            select(SceneCategory)
            .options(
                selectinload(SceneCategory.subcategories).selectinload(
                    SceneSubcategory.items
                )
            )
            .where(SceneCategory.is_active == True)
            .order_by(SceneCategory.order_index)
        )
        categories = result.scalars().all()

        hierarchy: Dict[int, Dict] = {}
        for category in categories:
            hierarchy[category.id] = {
                "name": category.name,
                "subcategories": {},
            }

            for subcategory in category.subcategories:
                if not subcategory.is_active:
                    continue
                hierarchy[category.id]["subcategories"][subcategory.id] = {
                    "name": subcategory.name,
                    "items": [
                        {
                            "id": item.id,
                            "name": item.name,
                            "prompt": item.prompt,
                        }
                        for item in subcategory.items
                        if item.is_active
                    ],
                }

        return hierarchy

    def search_items_by_keyword(self, keyword: str) -> List[SceneItem]:
        """Keyword bo'yicha scene item'larni qidirish"""
        keyword_lower = keyword.lower()
        result = self.session.execute(
            select(SceneItem)
            .where(
                SceneItem.is_active == True,
                (
                    SceneItem.name.ilike(f"%{keyword_lower}%") |
                    SceneItem.prompt.ilike(f"%{keyword_lower}%")
                )
            )
            .limit(10)
        )
        return list(result.scalars().all())
