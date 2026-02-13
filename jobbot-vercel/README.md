# JobBot — AI Job Matching (Vercel Edition)

Same matching engine as the Streamlit version, rebuilt as a proper Next.js app with full UI/UX control.

## Architecture

```
Frontend:  Next.js React (Vercel free tier)
Backend:   Next.js API Routes (serverless functions)
AI:        OpenRouter → Gemini 2.5 Flash
Jobs:      RSS feeds + Lever API + SerpAPI + JSearch
```

## Deploy to Vercel (5 minutes)

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "JobBot Vercel edition"
git remote add origin https://github.com/YOUR_USERNAME/jobbot-vercel.git
git push -u origin main
```

### 2. Deploy on Vercel
1. Go to [vercel.com](https://vercel.com) → Sign in with GitHub
2. Click **"Add New Project"**
3. Select your `jobbot-vercel` repo
4. Framework: **Next.js** (auto-detected)
5. Click **Deploy**

### 3. Done!
Your app is live at `jobbot-vercel.vercel.app`

## API Keys

Enter your API keys in the app sidebar (🔑 section). Keys are stored in your browser only — never sent to our servers.

| Key | Required | Free tier |
|-----|----------|-----------|
| OpenRouter | ✅ Yes | Free credits on signup |
| SerpAPI | Optional | 100 searches/month |
| JSearch (RapidAPI) | Optional | 500 requests/month |

## What's different from Streamlit?

- **Full UI control**: Custom CSS, animations, responsive layout
- **Faster**: React client-side rendering, no Streamlit overhead
- **Free**: Vercel free tier = unlimited deploys, 100GB bandwidth
- **No Python on server**: Everything runs in JS serverless functions
- **Same matching logic**: Identical scoring engine, same LLM prompts

## Local development

```bash
npm install
npm run dev
# Open http://localhost:3000
```
