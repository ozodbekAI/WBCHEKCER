# repositories/photo_asset_repository.py

from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_

from app.models.photo_asset import PhotoAsset, AssetType, AssetOwnerType


class PhotoAssetRepository:
    """PhotoAsset uchun repository"""
    
    def __init__(self, db: Session):
        self.db = db
    
    # ==================== CREATE ====================
    
    def create(
        self,
        asset_type: AssetType,
        owner_type: AssetOwnerType,
        name: str,
        image_url: str,
        user_id: Optional[int] = None,
        description: Optional[str] = None,
        prompt: Optional[str] = None,
        thumbnail_url: Optional[str] = None,
        category: Optional[str] = None,
        subcategory: Optional[str] = None,
        order_index: int = 0,
    ) -> PhotoAsset:
        """Yangi asset yaratish"""
        asset = PhotoAsset(
            asset_type=asset_type,
            owner_type=owner_type,
            user_id=user_id,
            name=name,
            description=description,
            prompt=prompt,
            image_url=image_url,
            thumbnail_url=thumbnail_url,
            category=category,
            subcategory=subcategory,
            order_index=order_index,
        )
        self.db.add(asset)
        self.db.commit()
        self.db.refresh(asset)
        return asset
    
    # ==================== READ ====================
    
    def get_by_id(self, asset_id: int) -> Optional[PhotoAsset]:
        """ID bo'yicha olish"""
        return self.db.query(PhotoAsset).filter(PhotoAsset.id == asset_id).first()
    
    def get_system_assets(
        self,
        asset_type: Optional[AssetType] = None,
        category: Optional[str] = None,
        is_active: bool = True,
    ) -> List[PhotoAsset]:
        """System assetlarni olish (admin yuklaganlari)"""
        query = self.db.query(PhotoAsset).filter(
            PhotoAsset.owner_type == AssetOwnerType.SYSTEM,
            PhotoAsset.is_active == is_active,
        )
        
        if asset_type:
            query = query.filter(PhotoAsset.asset_type == asset_type)
        
        if category:
            query = query.filter(PhotoAsset.category == category)
        
        return query.order_by(PhotoAsset.order_index, PhotoAsset.created_at.desc()).all()
    
    def get_user_assets(
        self,
        user_id: int,
        asset_type: Optional[AssetType] = None,
        category: Optional[str] = None,
        is_active: bool = True,
    ) -> List[PhotoAsset]:
        """User assetlarini olish (foydalanuvchi yuklaganlari)"""
        query = self.db.query(PhotoAsset).filter(
            PhotoAsset.owner_type == AssetOwnerType.USER,
            PhotoAsset.user_id == user_id,
            PhotoAsset.is_active == is_active,
        )
        
        if asset_type:
            query = query.filter(PhotoAsset.asset_type == asset_type)
        
        if category:
            query = query.filter(PhotoAsset.category == category)
        
        return query.order_by(PhotoAsset.order_index, PhotoAsset.created_at.desc()).all()
    
    def get_all_for_user(
        self,
        user_id: int,
        asset_type: Optional[AssetType] = None,
        category: Optional[str] = None,
    ) -> List[PhotoAsset]:
        """
        User uchun barcha assetlarni olish:
        - System assets (hamma ko'radi)
        - User's own assets
        """
        query = self.db.query(PhotoAsset).filter(
            PhotoAsset.is_active == True,
            or_(
                PhotoAsset.owner_type == AssetOwnerType.SYSTEM,
                and_(
                    PhotoAsset.owner_type == AssetOwnerType.USER,
                    PhotoAsset.user_id == user_id,
                )
            )
        )
        
        if asset_type:
            query = query.filter(PhotoAsset.asset_type == asset_type)
        
        if category:
            query = query.filter(PhotoAsset.category == category)
        
        return query.order_by(
            PhotoAsset.owner_type,  # System birinchi
            PhotoAsset.order_index,
            PhotoAsset.created_at.desc()
        ).all()
    
    def get_categories(
        self,
        asset_type: AssetType,
        owner_type: Optional[AssetOwnerType] = None,
        user_id: Optional[int] = None,
    ) -> List[str]:
        """Kategoriyalar ro'yxatini olish"""
        query = self.db.query(PhotoAsset.category).filter(
            PhotoAsset.asset_type == asset_type,
            PhotoAsset.is_active == True,
            PhotoAsset.category.isnot(None),
        )
        
        if owner_type:
            query = query.filter(PhotoAsset.owner_type == owner_type)
        
        if user_id and owner_type == AssetOwnerType.USER:
            query = query.filter(PhotoAsset.user_id == user_id)
        
        categories = query.distinct().all()
        return [c[0] for c in categories if c[0]]
    
    # ==================== UPDATE ====================
    
    def update(
        self,
        asset_id: int,
        **kwargs
    ) -> Optional[PhotoAsset]:
        """Assetni yangilash"""
        asset = self.get_by_id(asset_id)
        if not asset:
            return None
        
        for key, value in kwargs.items():
            if hasattr(asset, key) and value is not None:
                setattr(asset, key, value)
        
        self.db.commit()
        self.db.refresh(asset)
        return asset
    
    def toggle_active(self, asset_id: int) -> Optional[PhotoAsset]:
        """Aktivlikni o'zgartirish"""
        asset = self.get_by_id(asset_id)
        if asset:
            asset.is_active = not asset.is_active
            self.db.commit()
            self.db.refresh(asset)
        return asset
    
    # ==================== DELETE ====================
    
    def delete(self, asset_id: int) -> bool:
        """Assetni o'chirish"""
        asset = self.get_by_id(asset_id)
        if asset:
            self.db.delete(asset)
            self.db.commit()
            return True
        return False
    
    def delete_user_asset(self, asset_id: int, user_id: int) -> bool:
        """User o'z assetini o'chirish (xavfsizlik)"""
        asset = self.db.query(PhotoAsset).filter(
            PhotoAsset.id == asset_id,
            PhotoAsset.user_id == user_id,
            PhotoAsset.owner_type == AssetOwnerType.USER,
        ).first()
        
        if asset:
            self.db.delete(asset)
            self.db.commit()
            return True
        return False
