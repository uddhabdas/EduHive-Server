# Required Environment Variables

Complete list of all environment variables used in EduHive Server.

## 🔴 REQUIRED (Server won't start without these)

These are **MANDATORY** and the server will throw an error if they're missing:

### 1. Database
```env
MONGODB_URI=mongodb://localhost:27017/eduhive
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/eduhive?retryWrites=true&w=majority
```
**Used in:** `src/index.js`, `scripts/createAdmin.js`, `scripts/importPlaylists.js`

### 2. Authentication
```env
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
```
**Used in:** `src/index.js`, `src/middleware/auth.js`, `src/middleware/adminAuth.js`, `src/routes/auth.js`, `src/routes/stream.js`, `src/routes/courses.js`

---

## 🟡 OPTIONAL (Server will start but features won't work)

### 3. Server Configuration
```env
PORT=3000
# Default: 4000 (if not set)
```
**Used in:** `src/index.js`

```env
NODE_ENV=production
# Options: production, development
# Default: development
```
**Used in:** Multiple files for environment checks

### 4. Email Configuration (SMTP)
Required for sending OTP emails and notifications:
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@eduhive.com
SMTP_FROM_NAME=EduHive
SMTP_SECURE=false
# Set to "true" for port 465 (SSL), "false" for port 587 (TLS)
```
**Used in:** `src/utils/emailService.js`

**Note:** If SMTP is not configured, OTP emails won't be sent, but server will still run.

### 5. AWS S3 Configuration (Video Storage)
Required for uploading/deleting videos:
```env
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-bucket-name
```
**Used in:** `src/services/s3Service.js`

**Note:** Server will start without these, but video upload/delete features won't work.

### 6. AI Configuration (Gemini)
Optional - can be set via admin panel or environment:
```env
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.0-flash
# Default model: gemini-2.0-flash
```
**Used in:** `src/routes/ai.js`

**Note:** Can be configured via admin panel. Falls back to env vars if not set in database.

### 7. YouTube API (Optional)
Only needed for importing YouTube playlists:
```env
YOUTUBE_API_KEY=your-youtube-api-key
```
**Used in:** `src/utils/youtube.js`, `src/routes/dev.js`, `scripts/importPlaylists.js`

**Note:** Only required if you want to import YouTube playlists. Server runs without it.

### 8. Email Logo (Optional)
```env
EDUHIVE_LOGO_URL=https://your-domain.com/logo.png
# Default: placeholder image
```
**Used in:** `src/utils/emailTemplates.js`

### 9. Progress Configuration (Optional)
```env
PROGRESS_COMPLETION_THRESHOLD=0.9
# Default: 0.9 (90% watched to mark as complete)
# Range: 0.0 to 1.0

ALLOW_SKIP_IF_PREV_COMPLETED=true
# Default: true
# Set to "false" to prevent skipping lectures
```
**Used in:** `src/config/progress.js`

### 10. CORS Configuration
Currently CORS is enabled for all origins. If you need to restrict:
- Modify `src/index.js` line 46: `app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') }));`

---

## 📋 Complete .env Template

```env
# ============================================
# REQUIRED - Server won't start without these
# ============================================
MONGODB_URI=mongodb://localhost:27017/eduhive
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# ============================================
# SERVER CONFIGURATION
# ============================================
PORT=3000
NODE_ENV=production

# ============================================
# EMAIL CONFIGURATION (SMTP)
# ============================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@eduhive.com
SMTP_FROM_NAME=EduHive
SMTP_SECURE=false

# ============================================
# AWS S3 CONFIGURATION (Video Storage)
# ============================================
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-bucket-name

# ============================================
# AI CONFIGURATION (Gemini)
# ============================================
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-2.0-flash

# ============================================
# YOUTUBE API (Optional - for imports)
# ============================================
YOUTUBE_API_KEY=your-youtube-api-key

# ============================================
# EMAIL BRANDING (Optional)
# ============================================
EDUHIVE_LOGO_URL=https://your-domain.com/logo.png

# ============================================
# PROGRESS CONFIGURATION (Optional)
# ============================================
PROGRESS_COMPLETION_THRESHOLD=0.9
ALLOW_SKIP_IF_PREV_COMPLETED=true
```

---

## 🚀 For Render Deployment

**Minimum Required for Server to Start:**
1. `MONGODB_URI` ✅
2. `JWT_SECRET` ✅

**Recommended for Full Functionality:**
- All SMTP variables (for email)
- All AWS S3 variables (for video storage)
- `GEMINI_API_KEY` (for AI features)

---

## ⚠️ Important Notes

1. **Never commit `.env` file** - It's already in `.gitignore`
2. **Generate strong JWT_SECRET** - Use a long random string
3. **SMTP_PASS for Gmail** - Use App Password, not regular password
4. **AWS_S3_BUCKET_NAME** - Note: The code uses `AWS_S3_BUCKET_NAME`, not `AWS_S3_BUCKET`
5. **CORS** - Currently allows all origins. Modify code if you need to restrict.

