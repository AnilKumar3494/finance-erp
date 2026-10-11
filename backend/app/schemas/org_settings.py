from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator


class BrandingResponse(BaseModel):
    display_name: str
    short_name: str


class BrandingUpdate(BaseModel):
    """Partial update; an omitted field keeps its current value."""

    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    short_name: Optional[str] = Field(None, min_length=1, max_length=30)

    # mode="before" so the length limits apply to the trimmed value.
    @field_validator("display_name", "short_name", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @model_validator(mode="after")
    def _not_empty(self):
        if self.display_name is None and self.short_name is None:
            raise ValueError("Provide display_name and/or short_name")
        return self
