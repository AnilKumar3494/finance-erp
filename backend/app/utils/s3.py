import boto3
from botocore.exceptions import ClientError
from app.core.config import settings


# --------------------------------------------------
# S3 CLIENT
# --------------------------------------------------
def get_s3_client():
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
    )


# --------------------------------------------------
# UPLOAD
# --------------------------------------------------
def upload_file_to_s3(file_bytes: bytes, s3_key: str, content_type: str) -> str:
    """
    Upload a file to S3.
    Returns the s3_key on success.
    """
    client = get_s3_client()
    try:
        client.put_object(
            Bucket=settings.S3_BUCKET_NAME,
            Key=s3_key,
            Body=file_bytes,
            ContentType=content_type,
        )
        return s3_key
    except ClientError as e:
        raise ValueError(f"S3 upload failed: {str(e)}")


# --------------------------------------------------
# PRE-SIGNED DOWNLOAD URL
# --------------------------------------------------
def generate_presigned_url(s3_key: str, expires_in: int = 3600) -> str:
    """
    Generate a temporary download URL valid for `expires_in` seconds.
    Default: 1 hour
    """
    client = get_s3_client()
    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": settings.S3_BUCKET_NAME, "Key": s3_key},
            ExpiresIn=expires_in,
        )
        return url
    except ClientError as e:
        raise ValueError(f"Failed to generate URL: {str(e)}")


# --------------------------------------------------
# DELETE
# --------------------------------------------------
def delete_file_from_s3(s3_key: str) -> None:
    """
    Hard delete from S3.
    Only called when permanently purging — soft delete just marks DB record.
    """
    client = get_s3_client()
    try:
        client.delete_object(Bucket=settings.S3_BUCKET_NAME, Key=s3_key)
    except ClientError as e:
        raise ValueError(f"S3 delete failed: {str(e)}")
