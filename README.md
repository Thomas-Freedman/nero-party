## Note to Nero Team

I've basically arranged the updated repo such that setup follows a very similar process to the setup of the boilerplate repo provided. The detailed instructions are provided below. Multiple users can definitely be simulated by joining from several tabs, though the audio overlap might be annoying. Anyways, I hope you enjoy checking out the results!

## Prerequisites

- **Node.js** >= 18 (includes `npm`)
- A **YouTube Data API v3** key ([get one here](https://console.cloud.google.com/apis/library/youtube.googleapis.com))

## Setup

```bash
# 1. Clone the repo and cd into it
git clone <repo-url> && cd nero-party

# 2. Install all dependencies (root + backend + frontend)
npm install

# 3. Set up your environment variables
cp .env.example .env
```

Open `.env` and add your YouTube API key:

```
PORT=3000
YOUTUBE_API_KEY=your_youtube_api_key_here
```

```bash
# 4. Generate the Prisma client and create the SQLite database
cd backend
npx prisma generate
npx prisma migrate deploy
cd ..
```

## Running

From the project root:

```bash
npm run dev
```

Which starts both servers:
- **Frontend** → http://localhost:5173
- **Backend** → http://localhost:3000
