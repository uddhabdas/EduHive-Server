const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Initialize S3 client
const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

/**
 * Upload a video file to S3
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} fileName - The file name (will be prefixed with videos/)
 * @param {string} contentType - MIME type (e.g., 'video/mp4')
 * @returns {Promise<string>} - The S3 URL of the uploaded file
 */
async function uploadVideo(fileBuffer, fileName, contentType = 'video/mp4') {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured');
  }

  // Generate a unique filename with timestamp
  const timestamp = Date.now();
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  const key = `videos/${timestamp}-${sanitizedFileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: fileBuffer,
    ContentType: contentType,
    // Note: ACL is deprecated in newer S3 buckets with "Bucket owner enforced" setting
    // If your bucket has public read access via bucket policy, ACL is not needed
    // If you need private videos, remove ACL and use presigned URLs instead
    // ACL: 'public-read', // Uncomment if your bucket supports ACLs
  });

  try {
    await s3Client.send(command);
    
    // Return the public URL
    // Format: https://bucket-name.s3.region.amazonaws.com/key
    // For us-east-1, the format is slightly different: https://bucket-name.s3.amazonaws.com/key
    const region = process.env.AWS_REGION || 'us-east-1';
    let publicUrl;
    if (region === 'us-east-1') {
      publicUrl = `https://${BUCKET_NAME}.s3.amazonaws.com/${key}`;
    } else {
      publicUrl = `https://${BUCKET_NAME}.s3.${region}.amazonaws.com/${key}`;
    }
    return publicUrl;
  } catch (error) {
    console.error('S3 upload error:', error);
    throw new Error(`Failed to upload video to S3: ${error.message}`);
  }
}

/**
 * Delete a video from S3
 * @param {string} s3Url - The S3 URL of the file to delete
 * @returns {Promise<void>}
 */
async function deleteVideo(s3Url) {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured');
  }

  try {
    // Extract key from URL
    // URL format: https://bucket-name.s3.region.amazonaws.com/videos/filename
    const urlParts = s3Url.split('.amazonaws.com/');
    if (urlParts.length < 2) {
      throw new Error('Invalid S3 URL format');
    }
    const key = urlParts[1];

    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error('S3 delete error:', error);
    throw new Error(`Failed to delete video from S3: ${error.message}`);
  }
}

/**
 * Generate a presigned URL for private video access (if needed in future)
 * @param {string} key - The S3 key
 * @param {number} expiresIn - Expiration time in seconds (default: 1 hour)
 * @returns {Promise<string>} - Presigned URL
 */
async function getPresignedUrl(key, expiresIn = 3600) {
  if (!BUCKET_NAME) {
    throw new Error('AWS_S3_BUCKET_NAME is not configured');
  }

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  try {
    const url = await getSignedUrl(s3Client, command, { expiresIn });
    return url;
  } catch (error) {
    console.error('S3 presigned URL error:', error);
    throw new Error(`Failed to generate presigned URL: ${error.message}`);
  }
}

module.exports = {
  uploadVideo,
  deleteVideo,
  getPresignedUrl,
};

