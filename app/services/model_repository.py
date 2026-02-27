# backend/repositories/model_repository.py

from typing import List, Optional
from sqlalchemy.orm import Session

# Sening modellaring shu faylda: models/normalize_models.py
# ichida ModelCategory, ModelSubcategory, ModelItem bor
from app.models.generator import (
    ModelCategory,
    ModelSubcategory,
    ModelItem,
)


class ModelRepository:
    def __init__(self, db: Session):
        self.db = db

    # ==== CATEGORIES ====
    def list_categories(self) -> List[ModelCategory]:
        return (
            self.db.query(ModelCategory)
            .filter(ModelCategory.is_active == True)
            .order_by(ModelCategory.order_index, ModelCategory.id)
            .all()
        )

    def get_category(self, category_id: int) -> Optional[ModelCategory]:
        return (
            self.db.query(ModelCategory)
            .filter(
                ModelCategory.id == category_id,
                ModelCategory.is_active == True,
            )
            .first()
        )

    # ==== SUBCATEGORIES ====
    def list_subcategories_by_category(
        self, category_id: int
    ) -> List[ModelSubcategory]:
        return (
            self.db.query(ModelSubcategory)
            .filter(
                ModelSubcategory.category_id == category_id,
                ModelSubcategory.is_active == True,
            )
            .order_by(ModelSubcategory.order_index, ModelSubcategory.id)
            .all()
        )

    def get_subcategory(self, subcategory_id: int) -> Optional[ModelSubcategory]:
        return (
            self.db.query(ModelSubcategory)
            .filter(
                ModelSubcategory.id == subcategory_id,
                ModelSubcategory.is_active == True,
            )
            .first()
        )

    # ==== ITEMS (TIPAJI) ====
    def list_items_by_subcategory(
        self, subcategory_id: int
    ) -> List[ModelItem]:
        return (
            self.db.query(ModelItem)
            .filter(
                ModelItem.subcategory_id == subcategory_id,
                ModelItem.is_active == True,
            )
            .order_by(ModelItem.order_index, ModelItem.id)
            .all()
        )

    def get_item(self, item_id: int) -> Optional[ModelItem]:
        return (
            self.db.query(ModelItem)
            .filter(
                ModelItem.id == item_id,
                ModelItem.is_active == True,
            )
            .first()
        )
    def add_category(self, name: str, order_index: int = 0):
        cat = ModelCategory(name=name, order_index=order_index)
        self.db.add(cat)
        self.db.commit()
        self.db.refresh(cat)
        return cat

    def update_category(self, category_id: int, name: str, order_index: int):
        cat = self.db.query(ModelCategory).filter(ModelCategory.id == category_id).first()
        if not cat:
            return None
        cat.name = name
        cat.order_index = order_index
        self.db.commit()
        self.db.refresh(cat)
        return cat

    def delete_category(self, category_id: int):
        self.db.query(ModelItem).filter(ModelItem.subcategory.has(category_id=category_id)).delete()
        self.db.query(ModelSubcategory).filter(ModelSubcategory.category_id == category_id).delete()
        self.db.query(ModelCategory).filter(ModelCategory.id == category_id).delete()
        self.db.commit()

    # === SUBCATEGORY ===
    def add_subcategory(self, category_id: int, name: str, order_index: int = 0):
        sub = ModelSubcategory(category_id=category_id, name=name, order_index=order_index)
        self.db.add(sub)
        self.db.commit()
        self.db.refresh(sub)
        return sub

    def update_subcategory(self, sub_id: int, name: str, order_index: int):
        sub = self.db.query(ModelSubcategory).filter(ModelSubcategory.id == sub_id).first()
        if not sub:
            return None
        sub.name = name
        sub.order_index = order_index
        self.db.commit()
        self.db.refresh(sub)
        return sub

    # === ITEM ===
    def add_item(self, subcategory_id: int, name: str, prompt: str, order_index: int = 0):
        item = ModelItem(subcategory_id=subcategory_id, name=name, prompt=prompt, order_index=order_index)
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return item

    def update_item(self, item_id: int, name: str, prompt: str, order_index: int):
        item = self.db.query(ModelItem).filter(ModelItem.id == item_id).first()
        if not item:
            return None
        item.name = name
        item.prompt = prompt
        item.order_index = order_index
        self.db.commit()
        self.db.refresh(item)
        return item

    def get_full_hierarchy(self) -> dict:
        """Get full hierarchy of models in one query"""
        from sqlalchemy.orm import selectinload
        
        categories = (
            self.db.query(ModelCategory)
            .options(
                selectinload(ModelCategory.subcategories).selectinload(
                    ModelSubcategory.items
                )
            )
            .filter(ModelCategory.is_active == True)
            .order_by(ModelCategory.order_index)
            .all()
        )

        hierarchy = {}
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