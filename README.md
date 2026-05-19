# Creator Platform - Backend API

AI-powered creator platform backend with Express.js, PostgreSQL, and OpenAI integration.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Docker (for PostgreSQL)
- OpenAI API key (for AI features)

### Setup

1. **Start PostgreSQL with Docker:**
```bash
docker-compose up -d
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env and add your OpenAI API key
```

4. **Setup database:**
```bash
npm run db:generate  # Generate Prisma client
npm run db:push      # Create tables
npm run db:seed      # Add sample data
```

5. **Start development server:**
```bash
npm run dev
```

Server will start at `http://localhost:5000`

## 📁 Project Structure

```
Backend/
├── src/
│   ├── controllers/     # Route handlers
│   ├── routes/          # API routes
│   ├── middleware/      # Auth, error handling, uploads
│   ├── services/        # Business logic
│   ├── utils/           # OpenAI, vector store, YouTube
│   ├── socket/          # Socket.io handlers
│   ├── prisma/          # Database schema & seed
│   └── config/          # Configuration
├── uploads/             # File uploads
├── docker-compose.yml   # PostgreSQL setup
└── .env.example         # Environment template
```

## 🔑 API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user
- `PUT /api/auth/profile` - Update profile

### Creators
- `GET /api/creators` - List creators (public)
- `GET /api/creators/:id` - Get creator profile
- `GET /api/creators/categories` - Get categories
- `GET /api/creators/dashboard/me` - Creator dashboard
- `PUT /api/creators/profile` - Update creator profile

### Chat (Core Feature)
- `POST /api/chat/start` - Start conversation
- `POST /api/chat/message` - Send message (AI responds)
- `GET /api/chat/conversation/:id` - Get conversation
- `GET /api/chat/conversations` - Get user's conversations

### Content Training
- `POST /api/content/youtube` - Add YouTube video
- `POST /api/content/manual` - Add manual text
- `POST /api/content/faq` - Add FAQs
- `GET /api/content` - Get creator's content
- `DELETE /api/content/:id` - Delete content

### Subscriptions
- `GET /api/subscriptions/current` - Get subscription
- `GET /api/subscriptions/plans` - Get pricing plans
- `POST /api/subscriptions/upgrade` - Upgrade to premium

### Opportunities
- `GET /api/opportunities` - List opportunities
- `POST /api/opportunities` - Create opportunity (company)
- `POST /api/opportunities/:id/apply` - Apply (creator)

### Admin
- `GET /api/admin/stats` - Platform statistics
- `GET /api/admin/users` - List users
- `POST /api/admin/creators/:id/verify` - Verify creator

## 🔧 Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| DATABASE_URL | PostgreSQL connection string | Yes |
| JWT_SECRET | Secret for JWT tokens | Yes |
| OPENAI_API_KEY | OpenAI API key for AI features | For AI |
| RAZORPAY_KEY_ID | Razorpay key for payments | Optional |
| RAZORPAY_KEY_SECRET | Razorpay secret | Optional |
| GOOGLE_CLIENT_ID | Google OAuth client ID | Optional |

## 🧪 Test Credentials

After running `npm run db:seed`:

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@platform.com | admin123 |
| User | user@test.com | user123 |
| Creator | fitness@creator.com | creator123 |
| Creator | business@creator.com | creator123 |
| Creator | tech@creator.com | creator123 |
| Company | brand@company.com | company123 |

## 🛠 Scripts

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server
npm run db:generate  # Generate Prisma client
npm run db:push      # Push schema to database
npm run db:migrate   # Run migrations
npm run db:seed      # Seed database
npm run db:studio    # Open Prisma Studio
```

## 📝 Notes

- **Vector Store**: Uses SQLite-based local vector store (no Pinecone needed)
- **File Storage**: Local filesystem (uploads/ folder)
- **Payments**: Mock mode when Razorpay not configured
- **OAuth**: Optional Google OAuth support
