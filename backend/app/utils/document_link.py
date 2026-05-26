"""
Shared validator: when an Identity Proof or Stability Document references an
existing Document row via `document_id`, prove that the referenced document
is real, active, of the expected category, and belongs to the same owner.

Without these checks, a caller could attach any document UUID — including
another customer's KYC — to a proof/stability record. The DB only enforces
"the FK target exists"; it cannot enforce semantic ownership.

Use from a service layer; raises ValueError so the route can map to a 400.
"""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy.orm import Session

from app.models.document import DocCategory, Document


def validate_document_link(
    db: Session,
    document_id: uuid.UUID,
    *,
    expected_doc_type: DocCategory,
    expected_customer_id: Optional[uuid.UUID] = None,
    expected_loan_id: Optional[uuid.UUID] = None,
) -> Document:
    """Fetch & validate a Document referenced by an Identity / Stability row.

    Args:
        document_id:           the UUID supplied by the caller.
        expected_doc_type:     the only doc_type the child row may link to.
        expected_customer_id:  if provided, doc.customer_id must equal this.
        expected_loan_id:      if provided, doc.loan_id must equal this.

    Returns the active Document instance.

    Raises:
        ValueError with a generic, non-leaking message on any mismatch.

    Fail-closed: at least one of `expected_customer_id` / `expected_loan_id`
    MUST be supplied. Documents are always owned by a customer (NOT NULL
    in DB since migration 009), so calling this helper with both unset
    would let a caller attach any document to any child row — exactly the
    cross-tenant leak the helper exists to prevent. The personnel branch
    of identity_proof must NOT call this helper; it should reject
    `document_id` outright until documents can be owned by personnel.
    """
    if expected_customer_id is None and expected_loan_id is None:
        raise ValueError(
            "Document linkage requires either a customer or a loan scope. "
            "Personnel-owned documents are not yet supported."
        )

    doc = (
        db.query(Document)
        .filter(Document.id == document_id, Document.is_deleted == False)  # noqa: E712
        .first()
    )
    if doc is None:
        raise ValueError("Document not found or has been deleted")

    if doc.doc_type != expected_doc_type:
        # Don't leak the actual doc_type — just that it's the wrong category.
        raise ValueError(
            f"Document is not of type {expected_doc_type.value}"
        )

    if expected_customer_id is not None and doc.customer_id != expected_customer_id:
        raise ValueError("Document does not belong to this customer")

    if expected_loan_id is not None and doc.loan_id != expected_loan_id:
        raise ValueError("Document does not belong to this loan")

    return doc
