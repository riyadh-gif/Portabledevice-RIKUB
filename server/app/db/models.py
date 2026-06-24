import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Field(Base):
    __tablename__ = "fields"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    imagery = relationship(
        "FieldImagery",
        back_populates="field",
        cascade="all, delete-orphan",
    )


class FieldImagery(Base):
    __tablename__ = "field_imagery"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fields.id", ondelete="CASCADE"),
        nullable=False,
    )

    capture_at = Column(DateTime)

    rgb_tif_path = Column(Text, nullable=False)
    ndvi_tif_path = Column(Text, nullable=False)
    rgb_png_path = Column(Text)
    ndvi_png_path = Column(Text)

    top_left = Column(JSONB)
    top_right = Column(JSONB)
    bottom_left = Column(JSONB)
    bottom_right = Column(JSONB)
    ndvi_stats = Column(JSONB)

    created_at = Column(DateTime, server_default=func.now())

    field = relationship("Field", back_populates="imagery")


class SprayPolygon(Base):
    __tablename__ = "spray_polygons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_id = Column(
        UUID(as_uuid=True),
        ForeignKey("fields.id", ondelete="CASCADE"),
        nullable=False,
    )
    field_imagery_id = Column(
        UUID(as_uuid=True),
        ForeignKey("field_imagery.id", ondelete="CASCADE"),
        nullable=False,
    )

    zone_code = Column(Text, nullable=False)
    sequence_no = Column(Integer, nullable=False)
    geometry = Column(JSONB, nullable=False)
    area_m2 = Column(Float, nullable=False)
    mean_ndvi = Column(Float)
    settings = Column(JSONB, nullable=False)
    chamber = Column(Text, nullable=False, default="none")
    created_at = Column(DateTime, server_default=func.now())

    detections = relationship(
        "TargetDetection",
        back_populates="polygon",
        cascade="all, delete-orphan",
    )


class TargetDetection(Base):
    __tablename__ = "target_detections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    polygon_id = Column(
        UUID(as_uuid=True),
        ForeignKey("spray_polygons.id", ondelete="CASCADE"),
        nullable=False,
    )

    name = Column(Text, nullable=False)
    category = Column(Text, nullable=False)
    group_name = Column(Text, nullable=False)
    confidence = Column(Float)
    image_path = Column(Text)
    created_at = Column(DateTime, server_default=func.now())

    polygon = relationship("SprayPolygon", back_populates="detections")
