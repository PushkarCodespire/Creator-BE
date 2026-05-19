# Cloud Storage Configuration Guide

## Overview

The AI Creator Platform supports three storage providers for user-uploaded files (avatars, documents, content):

1. **Local** (default) - Files stored on server filesystem
2. **AWS S3** - Scalable cloud storage from Amazon Web Services
3. **Cloudinary** - Media management platform with built-in transformations

## Quick Start

### 1. Choose Storage Provider

Set in `Backend/.env`:

```bash
STORAGE_PROVIDER=local  # Options: local, s3, cloudinary
```

### 2. Configure Credentials (if using cloud)

**For AWS S3**:
```bash
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

**For Cloudinary**:
```bash
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 3. Restart Server

```bash
npm run dev
```

The storage provider will be initialized on startup.

---

## Storage Providers Comparison

| Feature | Local | AWS S3 | Cloudinary |
|---------|-------|--------|------------|
| **Setup Complexity** | ⭐ Easy | ⭐⭐⭐ Moderate | ⭐⭐ Easy |
| **Cost (Free Tier)** | Free | 5GB storage, 20K requests/month | 25GB storage, 25K transforms/month |
| **Scalability** | ❌ Limited | ✅ Unlimited | ✅ Unlimited |
| **CDN** | ❌ No | ⚠️ Requires CloudFront | ✅ Built-in |
| **Image Optimization** | ❌ Manual | ❌ Manual | ✅ Automatic |
| **Best For** | Development | Production (any file type) | Production (images/videos) |

---

## Setup Guides

### Local Storage (Default)

No configuration needed. Files are stored in `Backend/uploads/` directory.

**Structure**:
```
Backend/
├── uploads/
│   ├── avatars/      # User profile pictures
│   ├── content/      # Creator training content
│   ├── documents/    # PDF, TXT, DOC files
│   └── temp/         # Temporary files
```

**Access**: Files served via Express static middleware at `/uploads/*`

**Limitations**:
- Not suitable for production with multiple servers
- No CDN
- Manual backups required
- Disk space limited

---

### AWS S3 Setup

#### Step 1: Create S3 Bucket

1. Go to [AWS Console](https://console.aws.amazon.com/s3/)
2. Click **Create bucket**
3. Enter bucket name (e.g., `creator-platform-prod`)
4. Choose region (e.g., `us-east-1`)
5. **Uncheck** "Block all public access"
6. Enable versioning (optional)
7. Click **Create bucket**

#### Step 2: Configure Bucket Policy

Go to bucket → **Permissions** → **Bucket Policy**, add:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

Replace `your-bucket-name` with your bucket name.

#### Step 3: Create IAM User

1. Go to [IAM Console](https://console.aws.amazon.com/iam/)
2. Click **Users** → **Add users**
3. Enter username (e.g., `creator-platform-uploads`)
4. Select **Programmatic access**
5. Attach policy: **AmazonS3FullAccess** (or create custom policy)
6. Download credentials (Access Key ID + Secret Access Key)

**Custom Policy** (more secure):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:PutObjectAcl"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

#### Step 4: Configure Backend

In `Backend/.env`:

```bash
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

#### Step 5: Test Upload

```bash
npm run dev
```

Check logs for: `✅ AWS S3 storage initialized`

Upload an avatar via the app and verify it appears in S3 bucket.

#### Optional: Enable CloudFront CDN

1. Go to [CloudFront Console](https://console.aws.amazon.com/cloudfront/)
2. Create distribution with S3 bucket as origin
3. Update code to use CloudFront URL instead of S3 direct URL

**Cost**: ~$0.085/GB transfer (first 10TB/month)

---

### Cloudinary Setup

#### Step 1: Create Account

1. Go to [Cloudinary](https://cloudinary.com/users/register/free)
2. Sign up for free account
3. Verify email

#### Step 2: Get Credentials

1. Go to [Dashboard](https://cloudinary.com/console)
2. Copy:
   - **Cloud Name**
   - **API Key**
   - **API Secret**

#### Step 3: Configure Backend

In `Backend/.env`:

```bash
STORAGE_PROVIDER=cloudinary
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your-secret
```

#### Step 4: Test Upload

```bash
npm run dev
```

Check logs for: `✅ Cloudinary storage initialized`

Upload an avatar and verify it appears in Cloudinary Media Library.

#### Step 5: Configure Upload Presets (Optional)

In [Upload Settings](https://cloudinary.com/console/settings/upload):
- Create upload preset with transformations
- Add auto-format, auto-quality
- Set up folder structure

**Free Tier**:
- 25GB storage
- 25GB bandwidth/month
- 25,000 transformations/month

---

## Migration Guide

### Local → Cloud (S3/Cloudinary)

#### Step 1: Backup Local Files

```bash
cd Backend
tar -czf uploads-backup.tar.gz uploads/
```

#### Step 2: Upload Existing Files

**Option A: Manual Upload** (for small datasets)
- Upload files directly via AWS Console or Cloudinary Dashboard

**Option B: Migration Script** (recommended)

Create `Backend/scripts/migrate-to-cloud.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { uploadFile } from '../src/utils/storage';

async function migrateFiles() {
  const uploadDir = './uploads';
  const folders = ['avatars', 'content', 'documents'];

  for (const folder of folders) {
    const folderPath = path.join(uploadDir, folder);
    const files = fs.readdirSync(folderPath);

    console.log(`Migrating ${files.length} files from ${folder}...`);

    for (const filename of files) {
      const filePath = path.join(folderPath, filename);
      const stats = fs.statSync(filePath);

      if (stats.isFile()) {
        const file = {
          buffer: fs.readFileSync(filePath),
          originalname: filename,
          mimetype: getMimeType(filename),
          size: stats.size
        } as Express.Multer.File;

        try {
          const result = await uploadFile(file, folder);
          console.log(`✅ Uploaded: ${filename} -> ${result.url}`);
        } catch (error) {
          console.error(`❌ Failed: ${filename}`, error);
        }
      }
    }
  }
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

migrateFiles();
```

Run migration:

```bash
# Set cloud credentials in .env
STORAGE_PROVIDER=s3  # or cloudinary

# Run migration
tsx scripts/migrate-to-cloud.ts
```

#### Step 3: Update Database URLs

Update file URLs in database to use cloud URLs:

```sql
-- For S3
UPDATE creators SET "profileImage" = REPLACE("profileImage", '/uploads/', 'https://your-bucket.s3.amazonaws.com/');

-- For Cloudinary
UPDATE creators SET "profileImage" = REPLACE("profileImage", '/uploads/', 'https://res.cloudinary.com/your-cloud/');
```

#### Step 4: Update Environment

```bash
STORAGE_PROVIDER=s3  # or cloudinary
```

#### Step 5: Verify & Cleanup

1. Test app thoroughly
2. Verify all images load correctly
3. Keep local backup for 1 week
4. Delete local `uploads/` folder

---

## API Usage

### Uploading Files

The storage provider is transparent to your route handlers:

```typescript
import { uploadAvatar, uploadContent, uploadImages } from '../middleware/uploadCloud';

// Avatar upload (single image)
router.post('/avatar', uploadAvatar, async (req, res) => {
  const fileUrl = req.file?.path;  // Automatically cloud URL if configured
  const cloudKey = (req.file as any)?.cloudKey;  // For deletion

  await prisma.user.update({
    where: { id: req.user.id },
    data: { avatar: fileUrl }
  });

  res.json({ success: true, url: fileUrl });
});

// Content upload (documents)
router.post('/content', uploadContent, async (req, res) => {
  const fileUrl = req.file?.path;
  // ... save to database
});

// Multiple images
router.post('/gallery', uploadImages, async (req, res) => {
  const urls = (req.files as Express.Multer.File[]).map(f => f.path);
  // ... save to database
});
```

### Deleting Files

```typescript
import { deleteFile } from '../utils/storage';

// Delete avatar
router.delete('/avatar', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  if (user.avatar) {
    // Extract key/filename from URL
    const key = extractKeyFromUrl(user.avatar);
    await deleteFile(key, 'avatars');
  }

  await prisma.user.update({
    where: { id: req.user.id },
    data: { avatar: null }
  });

  res.json({ success: true });
});

function extractKeyFromUrl(url: string): string {
  if (url.includes('s3.amazonaws.com')) {
    // S3: https://bucket.s3.amazonaws.com/avatars/1234.jpg -> avatars/1234.jpg
    return url.split('.com/')[1];
  } else if (url.includes('cloudinary.com')) {
    // Cloudinary: extract public_id from URL
    const match = url.match(/\/v\d+\/(.+)\.\w+$/);
    return match ? match[1] : '';
  } else {
    // Local: /uploads/avatars/1234.jpg -> 1234.jpg
    return path.basename(url);
  }
}
```

### Getting File URLs

```typescript
import { getFileUrl } from '../utils/storage';

// Local: /uploads/avatars/image.jpg
// S3: https://bucket.s3.amazonaws.com/avatars/image.jpg
// Cloudinary: https://res.cloudinary.com/cloud/image/upload/v123/avatars/image.jpg

const url = getFileUrl('image.jpg', 'avatars');
```

---

## Performance Optimization

### 1. Enable Browser Caching

**For S3**, add cache headers:

```typescript
const command = new PutObjectCommand({
  Bucket: bucket,
  Key: key,
  Body: file.buffer,
  ContentType: file.mimetype,
  ACL: 'public-read',
  CacheControl: 'max-age=31536000, public'  // 1 year
});
```

**For Cloudinary**, use transformations with caching:

```typescript
cloudinary.url('image.jpg', {
  cache_control: 'public, max-age=31536000'
});
```

### 2. Use CDN

- **S3**: Enable CloudFront distribution
- **Cloudinary**: CDN included automatically

### 3. Compress Images

See `CLOUD_STORAGE.md` Image Optimization section (coming next).

---

## Troubleshooting

### Error: "S3 client not initialized"

**Cause**: AWS credentials not configured or invalid

**Solution**:
```bash
# Check .env file
cat .env | grep AWS

# Verify credentials are correct
# Test with AWS CLI:
aws s3 ls --profile default
```

### Error: "Cloudinary credentials not configured"

**Cause**: Missing Cloudinary environment variables

**Solution**:
```bash
# Check .env file
cat .env | grep CLOUDINARY

# All three variables required:
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=123456789012345
CLOUDINARY_API_SECRET=your-secret
```

### Error: "Access Denied" (S3)

**Cause**: IAM user lacks permissions or bucket policy too restrictive

**Solution**:
1. Check IAM user has `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject`
2. Verify bucket policy allows public read
3. Check bucket CORS configuration if uploading from browser

### Files Not Appearing After Upload

**Check**:
1. Backend logs for upload confirmation
2. Storage provider dashboard (S3 console, Cloudinary media library)
3. File URL in database is correct
4. CORS headers if loading images cross-origin

### Large File Upload Fails

**Solutions**:
- Increase `MAX_FILE_SIZE` in `.env`
- Check cloud provider file size limits:
  - S3: 5GB per PUT (use multipart for larger)
  - Cloudinary: 100MB for images (free tier)
- Adjust Nginx/server timeout if using reverse proxy

---

## Cost Estimates

### AWS S3

**Storage**: $0.023/GB/month (first 50TB)
**Transfer**: $0.09/GB (first 10TB/month)
**Requests**: $0.0004 per 1000 PUT requests

**Example** (1000 users):
- Storage: 10GB = $0.23/month
- Transfer: 100GB = $9/month
- Requests: 10K uploads = $0.004/month
- **Total**: ~$10/month

### Cloudinary

**Free Tier**:
- 25GB storage
- 25GB bandwidth/month
- 25,000 transformations/month

**Paid Plans**:
- Plus: $99/month (150GB storage, 150GB bandwidth)
- Advanced: $249/month (500GB storage, 500GB bandwidth)

**Example** (1000 users within free tier):
- Storage: 10GB
- Bandwidth: 20GB/month
- Transformations: 15K/month
- **Total**: $0/month

---

## Security Best Practices

### 1. Never Commit Credentials

```bash
# Add to .gitignore
.env
.env.local
```

### 2. Use IAM Roles (AWS)

For production, use EC2 IAM roles instead of access keys.

### 3. Restrict Bucket Access

- Use private buckets with signed URLs for sensitive files
- Enable bucket versioning for rollback
- Set up lifecycle policies to delete old versions

### 4. Validate File Types

```typescript
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif'];
if (!ALLOWED_TYPES.includes(file.mimetype)) {
  throw new Error('Invalid file type');
}
```

### 5. Limit File Sizes

```typescript
limits: {
  fileSize: 5 * 1024 * 1024  // 5MB
}
```

### 6. Scan for Malware

Integrate with:
- AWS: Amazon Macie, third-party AV
- Cloudinary: Built-in moderation features

---

## Next Steps

1. **Image Optimization**: See `IMAGE_OPTIMIZATION.md` (coming next)
2. **Backup Strategy**: Set up automated backups
3. **Monitoring**: Track storage costs and usage
4. **Content Delivery**: Optimize with CDN

---

**Last Updated**: 2025-12-18
**Status**: ✅ Implemented and tested
