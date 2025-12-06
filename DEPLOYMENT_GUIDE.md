# EduHive Server Deployment Guide

Complete guide to deploy the EduHive backend server to production.

## Prerequisites

- Node.js 18+ installed
- MongoDB database (local or cloud like MongoDB Atlas)
- AWS S3 bucket (for video storage)
- SMTP email service (Gmail, SendGrid, etc.)
- Domain name (optional, for production)
- Server/VPS (AWS EC2, DigitalOcean, Heroku, Railway, etc.)

## Environment Variables Setup

Create a `.env` file in `server/` directory with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# MongoDB Connection
MONGODB_URI=mongodb://localhost:27017/eduhive
# OR for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/eduhive?retryWrites=true&w=majority

# JWT Secret (generate a strong random string)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production

# AWS S3 Configuration (for video storage)
AWS_ACCESS_KEY_ID=your-aws-access-key
AWS_SECRET_ACCESS_KEY=your-aws-secret-key
AWS_REGION=us-east-1
AWS_S3_BUCKET_NAME=your-bucket-name
# Note: Variable name is AWS_S3_BUCKET_NAME (not AWS_S3_BUCKET)

# Email Configuration (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=noreply@eduhive.com
SMTP_FROM_NAME=EduHive
SMTP_SECURE=false
# Set to "true" for port 465 (SSL), "false" for port 587 (TLS)

# Email Logo URL (optional)
EDUHIVE_LOGO_URL=https://your-domain.com/logo.png

# CORS Configuration
CORS_ORIGIN=https://your-frontend-domain.com,https://your-mobile-app-domain.com

# Admin Configuration (optional, for initial admin creation)
ADMIN_EMAIL=admin@eduhive.com
ADMIN_PASSWORD=secure-admin-password

# YouTube API (optional, for importing playlists)
YOUTUBE_API_KEY=your-youtube-api-key
```

## Deployment Options

### Option 1: Deploy to Railway (Recommended for Quick Setup)

1. **Install Railway CLI:**
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway:**
   ```bash
   railway login
   ```

3. **Initialize Railway project:**
   ```bash
   cd server
   railway init
   ```

4. **Set environment variables:**
   - Go to Railway dashboard
   - Select your project
   - Go to Variables tab
   - Add all environment variables from above

5. **Deploy:**
   ```bash
   railway up
   ```

6. **Get your deployment URL:**
   - Railway will provide a URL like `https://your-app.railway.app`
   - Update `CORS_ORIGIN` in environment variables with your frontend URL

### Option 2: Deploy to Render

1. **Create a Render account:**
   - Go to [render.com](https://render.com)
   - Sign up or log in

2. **Create a new Web Service:**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository (the server repository)
   - **IMPORTANT**: Set **Root Directory** to `/` (root) or leave it empty
     - Do NOT set it to `/server` or `/src/server`
     - Since your GitHub repo root IS the server, use root directory

3. **Configure the service:**
   - **Name**: `eduhive-server` (or your preferred name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Root Directory**: `/` (or leave empty)

4. **Set environment variables:**
   - In the Render dashboard, go to "Environment" tab
   - Add all environment variables:
     - `MONGODB_URI`
     - `JWT_SECRET`
     - `PORT` (Render sets this automatically, but you can set it to `10000`)
     - `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SMTP_FROM_NAME`, `SMTP_SECURE`
     - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`
     - `CORS_ORIGIN` (your frontend URLs)

5. **Deploy:**
   - Click "Create Web Service"
   - Render will automatically build and deploy
   - Wait for deployment to complete

6. **Get your deployment URL:**
   - Render will provide a URL like `https://eduhive-server.onrender.com`
   - Update `CORS_ORIGIN` in environment variables with your frontend URL

**Note**: If you see an error about `/opt/render/project/src/server/package.json` not found:
- Go to Settings → Root Directory
- Change it from `/src/server` or `/server` to `/` (root)
- Save and redeploy

### Option 3: Deploy to Heroku

1. **Install Heroku CLI:**
   ```bash
   npm install -g heroku
   ```

2. **Login to Heroku:**
   ```bash
   heroku login
   ```

3. **Create Heroku app:**
   ```bash
   cd server
   heroku create your-app-name
   ```

4. **Add MongoDB addon:**
   ```bash
   heroku addons:create mongolab:sandbox
   ```

5. **Set environment variables:**
   ```bash
   heroku config:set NODE_ENV=production
   heroku config:set JWT_SECRET=your-secret-key
   heroku config:set MONGODB_URI=$(heroku config:get MONGOLAB_URI)
   heroku config:set AWS_ACCESS_KEY_ID=your-key
   heroku config:set AWS_SECRET_ACCESS_KEY=your-secret
   heroku config:set AWS_REGION=us-east-1
   heroku config:set AWS_S3_BUCKET_NAME=your-bucket
   heroku config:set SMTP_HOST=smtp.gmail.com
   heroku config:set SMTP_PORT=587
   heroku config:set SMTP_USER=your-email@gmail.com
   heroku config:set SMTP_PASS=your-app-password
   heroku config:set SMTP_FROM=noreply@eduhive.com
   heroku config:set CORS_ORIGIN=https://your-frontend.com
   ```

6. **Deploy:**
   ```bash
   git push heroku main
   ```

### Option 4: Deploy to AWS EC2 / DigitalOcean / VPS

1. **SSH into your server:**
   ```bash
   ssh user@your-server-ip
   ```

2. **Install Node.js and MongoDB:**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo apt-get install -y mongodb
   
   # Or use MongoDB Atlas (cloud) instead
   ```

3. **Install PM2 (Process Manager):**
   ```bash
   sudo npm install -g pm2
   ```

4. **Clone your repository:**
   ```bash
   git clone https://github.com/your-username/eduhive.git
   cd eduhive/server
   ```

5. **Install dependencies:**
   ```bash
   npm install --production
   ```

6. **Create .env file:**
   ```bash
   nano .env
   # Paste all environment variables
   ```

7. **Start with PM2:**
   ```bash
   pm2 start src/index.js --name eduhive-server
   pm2 save
   pm2 startup
   ```

8. **Setup Nginx (Reverse Proxy):**
   ```bash
   sudo apt-get install nginx
   sudo nano /etc/nginx/sites-available/eduhive
   ```

   Add this configuration:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   Enable site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/eduhive /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl restart nginx
   ```

9. **Setup SSL with Let's Encrypt:**
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

### Option 4: Deploy with Docker

1. **Build Docker image:**
   ```bash
   cd server
   docker build -t eduhive-server .
   ```

2. **Run container:**
   ```bash
   docker run -d \
     --name eduhive-server \
     -p 3000:3000 \
     --env-file server/.env \
     eduhive-server
   ```

3. **Or use docker-compose:**
   ```bash
   cd server
   docker-compose up -d
   ```

## Post-Deployment Steps

### 1. Create Admin User

```bash
cd server
node scripts/createAdmin.js
```

Or use the API:
```bash
curl -X POST https://your-server.com/api/admin/create-admin \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@eduhive.com",
    "password": "secure-password",
    "name": "Admin User"
  }'
```

### 2. Verify Server Health

```bash
curl https://your-server.com/api/health
```

Should return:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 3. Test API Endpoints

```bash
# Test authentication
curl -X POST https://your-server.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123",
    "name": "Test User"
  }'

# Test login
curl -X POST https://your-server.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test123"
  }'
```

### 4. Update Frontend Configuration

Update your frontend `.env` or configuration file:

```env
NEXT_PUBLIC_API_URL=https://your-server.com
```

## Monitoring & Maintenance

### PM2 Commands (if using VPS)

```bash
# View logs
pm2 logs eduhive-server

# Restart server
pm2 restart eduhive-server

# Stop server
pm2 stop eduhive-server

# View status
pm2 status

# Monitor
pm2 monit
```

### Health Checks

Set up monitoring to check:
- Server is responding: `GET /api/health`
- Database connection is working
- S3 bucket is accessible
- Email service is working

### Backup Strategy

1. **MongoDB Backup:**
   ```bash
   mongodump --uri="mongodb://localhost:27017/eduhive" --out=/backup/eduhive-$(date +%Y%m%d)
   ```

2. **S3 Backup:**
   - Enable versioning on S3 bucket
   - Setup lifecycle policies for old versions

3. **Automated Backups:**
   - Use cron jobs for daily backups
   - Store backups in separate S3 bucket or external storage

## Troubleshooting

### Server won't start

1. Check environment variables:
   ```bash
   node -e "console.log(process.env.MONGODB_URI)"
   ```

2. Check logs:
   ```bash
   pm2 logs eduhive-server
   # or
   docker logs eduhive-server
   ```

3. Verify MongoDB connection:
   ```bash
   mongosh "your-mongodb-uri"
   ```

### CORS Errors

- Ensure `CORS_ORIGIN` includes your frontend domain
- Check that frontend is using correct API URL
- Verify headers are being sent correctly

### Email Not Sending

1. Check SMTP credentials
2. For Gmail, use App Password (not regular password)
3. Check spam folder
4. Verify SMTP port (587 for TLS, 465 for SSL)

### Video Streaming Issues

1. Verify S3 bucket permissions
2. Check CORS configuration on S3 bucket
3. Verify AWS credentials
4. Check video file formats (HLS .m3u8 files)

## Security Checklist

- [ ] Change default JWT_SECRET
- [ ] Use strong passwords for admin accounts
- [ ] Enable HTTPS/SSL
- [ ] Set up firewall rules
- [ ] Regular security updates
- [ ] Database access restricted
- [ ] S3 bucket permissions properly configured
- [ ] Environment variables secured (not in git)
- [ ] Rate limiting enabled
- [ ] Input validation on all endpoints

## Scaling

### Horizontal Scaling

- Use load balancer (AWS ALB, Nginx)
- Multiple server instances
- Shared MongoDB database
- Shared S3 bucket

### Vertical Scaling

- Increase server resources (CPU, RAM)
- Optimize database queries
- Use CDN for static assets
- Enable caching

## Support

For issues or questions:
- Check server logs
- Review API documentation
- Contact development team

---

**Last Updated:** 2024-01-01
**Version:** 1.0.0

