"""WhatsApp provider adapters for outbound EMI reminders.

The reminder job talks to `get_provider()` (factory.py), never to a concrete
provider, so swapping Meta for Twilio/a BSP later is a one-file change.
"""
from app.services.whatsapp.base import SendResult, WhatsAppProvider, normalize_phone
from app.services.whatsapp.factory import get_provider

__all__ = ["SendResult", "WhatsAppProvider", "normalize_phone", "get_provider"]
