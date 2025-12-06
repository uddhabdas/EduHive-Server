# EduHive Server

Backend server for EduHive - A Mobile eLearning Platform

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Database**: MongoDB
- **Authentication**: JWT (JSON Web Tokens)
- **File Storage**: AWS S3
- **Email**: Nodemailer (SMTP)

## Quick Start

### Prerequisites

- Node.js 18+ installed
- MongoDB database (local or MongoDB Atlas)
- AWS S3 bucket (for video storage)
- SMTP email service (Gmail, SendGrid, etc.)

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   Copy the environment variables from `DEPLOYMENT_GUIDE.md` and create a `.env` file in the root directory.

3. **Start the server:**
   ```bash
   npm start
   ```

   For development with auto-reload:
   ```bash
   npx nodemon src/index.js
   ```

## Environment Variables

Required environment variables (see `DEPLOYMENT_GUIDE.md` for details):

- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `PORT` - Server port (default: 3000)
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` - Email configuration
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET` - AWS S3 configuration
- `CORS_ORIGIN` - Allowed CORS origins

## Scripts

- `npm start` - Start the server
- `npm run create:admin` - Create an admin user
- `npm run import:yt` - Import YouTube playlists

## API Endpoints

The server provides RESTful API endpoints for:
- Authentication (login, register, OTP)
- Course management
- User management
- Wallet/transactions
- Admin operations
- AI assistant integration

## Deployment

See `DEPLOYMENT_GUIDE.md` for detailed deployment instructions for:
- Render
- Railway
- Heroku
- VPS/EC2

## Project Structure

```
server/
├── src/
│   ├── config/          # Configuration files
│   ├── middleware/      # Auth middleware
│   ├── models/          # MongoDB models
│   ├── routes/          # API routes
│   ├── services/        # External services (S3, YouTube)
│   └── utils/           # Utility functions
├── scripts/             # Utility scripts
├── package.json
└── .env                 # Environment variables (not in git)
```

## License

ISC
