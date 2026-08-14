import logging
from functools import lru_cache
from typing import Optional

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.core.config import settings

logger = logging.getLogger(__name__)


# --------------------------------------------------
# S3 CLIENT (cached singleton — boto3 client is thread-safe)
# --------------------------------------------------
@lru_cache(maxsize=1)
def get_s3_client():
    return boto3.client("s3", region_name=settings.AWS_REGION)


# --------------------------------------------------
# S3 PROBE CLIENT — short-timeout, no-retry client for /readyz.
# The default boto3 client retries 3× with exponential backoff and uses
# 60-second connect / 60-second read timeouts. That's the correct default
# for an upload (we want to survive a transient blip) but it's the wrong
# default for a health probe — a slow S3 keeps every k8s readiness check
# blocked for minutes and ties up workers behind the GIL.
#
# This client is cached separately so the per-request `get_s3_client()`
# keeps its retry behaviour.
# --------------------------------------------------
@lru_cache(maxsize=1)
def get_s3_probe_client():
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        config=Config(
            connect_timeout=2,         # seconds — fail fast on network issues
            read_timeout=2,            # seconds — head_bucket is ~1 KB so 2s is generous
            # `total_max_attempts` is the count of TOTAL attempts (including the
            # initial call). 1 = exactly one call, no retries. Using the
            # `max_attempts` key here would mean "retries on top of initial"
            # (botocore adds +1), so it would silently allow 2 calls.
            retries={"total_max_attempts": 1, "mode": "standard"},
        ),
    )


# --------------------------------------------------
# UPLOAD with Server-Side Encryption
# --------------------------------------------------
def upload_file_to_s3(file_bytes: bytes, s3_key: str, content_type: str) -> str:
    """
    Upload a file to S3 with server-side encryption.
    If KMS_KEY_ID is set in config → uses aws:kms.
    Otherwise → falls back to AES256.
    Returns the s3_key on success.
    """
    client = get_s3_client()
    extra_args = {
        "Bucket": settings.S3_BUCKET_NAME,
        "Key": s3_key,
        "Body": file_bytes,
        "ContentType": content_type or "application/octet-stream",
    }
    if settings.KMS_KEY_ID:
        extra_args["ServerSideEncryption"] = "aws:kms"
        extra_args["SSEKMSKeyId"] = settings.KMS_KEY_ID
    else:
        extra_args["ServerSideEncryption"] = "AES256"

    try:
        client.put_object(**extra_args)
        return s3_key
    except ClientError as e:
        logger.exception("S3 upload failed for key %s", s3_key)
        raise ValueError(f"S3 upload failed: {e}")


# --------------------------------------------------
# PRE-SIGNED DOWNLOAD URL (TTL 480s = 8 min, force download)
# --------------------------------------------------
# File extensions the browser can safely render in-place. PDFs open in the
# built-in viewer and images render directly; none of these execute script.
# HTML/SVG are deliberately absent — they can run script, so they stay
# forced-download (the XSS hardening this disposition logic exists for), as
# does any extension we can't vouch for.
_INLINE_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "gif": "image/gif",
    "webp": "image/webp",
}


def generate_presigned_url(
    s3_key: str,
    file_name: Optional[str] = None,
    expires_in: Optional[int] = None,
) -> str:
    """
    Generate a temporary download URL.
    - Default expiry comes from settings.PRESIGNED_URL_TTL_SECONDS (8 min).
    - When file_name is given, PDFs and images get 'inline' disposition (so the
      browser previews them in a new tab) while every other type — notably
      HTML/SVG, which can execute script — is forced to 'attachment' download.
    """
    client = get_s3_client()
    ttl = expires_in if expires_in is not None else settings.PRESIGNED_URL_TTL_SECONDS
    params = {"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key}
    if file_name:
        ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
        inline_type = _INLINE_CONTENT_TYPES.get(ext)
        if inline_type:
            # Safe to preview in-browser — render inline and pin the content
            # type so the viewer opens regardless of the stored object type.
            params["ResponseContentDisposition"] = f'inline; filename="{file_name}"'
            params["ResponseContentType"] = inline_type
        else:
            # force download instead of in-browser render — XSS hardening
            params["ResponseContentDisposition"] = f'attachment; filename="{file_name}"'
    try:
        return client.generate_presigned_url("get_object", Params=params, ExpiresIn=ttl)
    except ClientError as e:
        logger.exception("Presigned URL generation failed for %s", s3_key)
        raise ValueError(f"Failed to generate URL: {e}")


# --------------------------------------------------
# DELETE
# --------------------------------------------------
def delete_file_from_s3(s3_key: str) -> None:
    """Hard delete from S3. Used during upload-rollback and purge."""
    client = get_s3_client()
    try:
        client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
    except ClientError as e:
        logger.exception("S3 delete failed for key %s", s3_key)
        raise ValueError(f"S3 delete failed: {e}")


# --------------------------------------------------
# MOVE / ARCHIVE (copy + delete)
# --------------------------------------------------
def archive_file_in_s3(old_key: str, new_key: str) -> None:
    """Copy then delete — used by soft-delete and restore."""
    client = get_s3_client()
    bucket = settings.S3_BUCKET_NAME
    try:
        client.copy_object(
            CopySource={"Bucket": bucket, "Key": old_key},
            Bucket=bucket,
            Key=new_key,
        )
        client.delete_object(Bucket=bucket, Key=old_key)
    except ClientError as e:
        logger.exception("S3 archive failed: %s -> %s", old_key, new_key)
        raise ValueError(f"S3 archive failed: {e}")
