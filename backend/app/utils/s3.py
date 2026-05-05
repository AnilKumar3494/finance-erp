import logging
from functools import lru_cache
from typing import Optional

import boto3
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
def generate_presigned_url(
    s3_key: str,
    file_name: Optional[str] = None,
    expires_in: Optional[int] = None,
) -> str:
    """
    Generate a temporary download URL.
    - Default expiry comes from settings.PRESIGNED_URL_TTL_SECONDS (8 min).
    - When file_name is given, the URL forces 'attachment' disposition,
      preventing inline execution of HTML/SVG/PDF inside the browser.
    """
    client = get_s3_client()
    ttl = expires_in if expires_in is not None else settings.PRESIGNED_URL_TTL_SECONDS
    params = {"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key}
    if file_name:
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
