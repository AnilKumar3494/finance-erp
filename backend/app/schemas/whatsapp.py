import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


# --------------------------------------------------
# SETTINGS
# --------------------------------------------------
class ReminderSettingsResponse(BaseModel):
    reminders_enabled: bool
    template_name: str
    template_language: str
    template_body_preview: str
    reminder_offsets_days: list[int]
    send_hour: int
    send_minute: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReminderSettingsUpdate(BaseModel):
    reminders_enabled: Optional[bool] = None
    template_name: Optional[str] = Field(None, min_length=1, max_length=512)
    template_language: Optional[str] = Field(None, min_length=2, max_length=10)
    template_body_preview: Optional[str] = Field(None, min_length=1)
    reminder_offsets_days: Optional[list[int]] = None
    send_hour: Optional[int] = Field(None, ge=0, le=23)
    send_minute: Optional[int] = Field(None, ge=0, le=59)

    model_config = {"extra": "forbid"}

    @field_validator("reminder_offsets_days")
    @classmethod
    def _v_offsets(cls, v: Optional[list[int]]) -> Optional[list[int]]:
        if v is None:
            return v
        if not v:
            raise ValueError("At least one reminder offset is required")
        cleaned = sorted({int(o) for o in v}, reverse=True)
        if any(o < 0 or o > 90 for o in cleaned):
            raise ValueError("Each offset must be between 0 and 90 days")
        return cleaned


# --------------------------------------------------
# TEST SEND
# --------------------------------------------------
class ReminderTestRequest(BaseModel):
    to: str = Field(..., description="Phone number (any format; normalised to E.164)")
    variables: Optional[list[str]] = Field(
        None,
        description="Template body variables. Defaults to sample values if omitted.",
    )


class ReminderTestResponse(BaseModel):
    ok: bool
    dry_run: bool
    to: Optional[str] = None
    message_id: Optional[str] = None
    error: Optional[str] = None


# --------------------------------------------------
# RUN-NOW
# --------------------------------------------------
class ReminderRunResponse(BaseModel):
    enabled: bool
    offsets: list[int]
    candidates: int
    sent: int
    dry_run: int
    failed: int
    skipped: int
    already_done: int


# --------------------------------------------------
# LOG
# --------------------------------------------------
class ReminderLogItem(BaseModel):
    id: uuid.UUID
    due_cycle_id: uuid.UUID
    loan_id: uuid.UUID
    customer_id: uuid.UUID
    offset_days: int
    phone: Optional[str] = None
    status: str
    provider_message_id: Optional[str] = None
    error: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ReminderLogResponse(BaseModel):
    total: int
    page: int
    page_size: int
    results: list[ReminderLogItem]


# --------------------------------------------------
# PER-ENTITY TOGGLE
# --------------------------------------------------
class ReminderToggleRequest(BaseModel):
    enabled: bool

    model_config = {"extra": "forbid"}
