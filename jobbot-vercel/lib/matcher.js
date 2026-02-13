// lib/matcher.js — Job matching engine (ported from run_auto_apply.py)

const MAX_MATCHES = 20;
const LLM_BATCH_SIZE = 15;
const MAX_LLM_CANDIDATES = 60;
const MATCH_THRESHOLD = 25;
const MAX_PER_COMPANY = 3;

// ---- Seniority detection ----
const SENIOR_MARKERS = [
  'lead', 'head of', 'director', 'vp ', 'vice president',
  'principal', 'chief', 'cto', 'coo', 'ceo', 'cfo',
  'founding', 'co-founder', 'svp', 'evp',
  'staff engineer', 'distinguished',
];
const MID_MARKERS = ['senior', 'sr ', 'sr.'];

function titleSeniority(title) {
  const t = title.toLowerCase();
  if (SENIOR_MARKERS.some(m => t.includes(m))) return 'senior';
  if (MID_MARKERS.some(m => t.includes(m))) return 'mid';
  return 'open';
}

// ---- Experience parsing ----
export function estimateYears(profile) {
  const expStr = (profile.experience || '').trim();
  const map = {
    '0–1 years': 0, '0-1 years': 0,
    '1–3 years': 2, '1-3 years': 2,
    '3–6 years': 4, '3-6 years': 4,
    '6–10 years': 7, '6-10 years': 7,
    '10+ years': 12,
  };
  if (map[expStr] !== undefined) return map[expStr];

  const headline = (profile.headline || '').toLowerCase();
  const m = headline.match(/(\d+)\+?\s*(?:years?|yrs?)/);
  if (m) return parseInt(m[1]);
  if (/intern|trainee|fresher/.test(headline)) return 0;
  if (/junior|associate/.test(headline)) return 1;
  if (/senior|lead|manager/.test(headline)) return 5;
  if (/director|head of|vp/.test(headline)) return 10;
  return 3;
}

// ---- Keyword extraction ----
export function extractKeywords(profile) {
  const skills = (profile.skills || []).map(s => s.toLowerCase().trim());
  const headline = (profile.headline || '').toLowerCase();
  const industry = (profile.industry || '').toLowerCase();

  const stopWords = new Set([
    'and', 'the', 'for', 'with', 'from', 'into', 'our', 'you', 'your',
    'tool', 'tools', 'using', 'based', 'related', 'across', 'including',
    'such', 'various', 'multiple', 'key', 'core', 'new', 'high', 'low',
  ]);

  const primary = new Set();

  // Add skills as-is
  for (const s of skills) {
    if (s.length > 2) primary.add(s);
  }

  // Add headline terms
  const headlineTerms = headline.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  for (const t of headlineTerms) primary.add(t);

  // Add industry
  if (industry && industry.length > 2) primary.add(industry);

  // Expand multi-word skills into individual words
  const expanded = new Set();
  for (const skill of skills) {
    for (const word of skill.split(/\s+/)) {
      const clean = word.replace(/[.,;:()/\-]/g, '');
      if (clean.length > 3 && !stopWords.has(clean)) expanded.add(clean);
    }
  }

  // Stem variants
  const stemMap = {
    operations: ['operational', 'ops'],
    management: ['manager', 'managing'],
    manager: ['management', 'managing'],
    automation: ['automated', 'automate'],
    integration: ['integrating', 'integrate'],
    development: ['developer', 'developing'],
    engineering: ['engineer'],
  };
  for (const word of [...expanded]) {
    if (stemMap[word]) {
      for (const v of stemMap[word]) expanded.add(v);
    }
  }

  const allPrimary = new Set([...primary, ...expanded]);

  // Title words from headline
  const titleWords = new Set(headlineTerms.filter(w => w.length > 2));

  return { primary: allPrimary, titleWords };
}

// ---- Non-English filter ----
function isNonEnglish(title, summary) {
  const text = `${title} ${summary}`.toLowerCase();
  const indicators = ['español', 'português', 'français', 'deutsch', '中文', '日本語', '한국어'];
  return indicators.some(i => text.includes(i));
}

// ---- Local scoring (0 API calls) ----
function scoreLocally(job, primary, titleWords, candidateYears) {
  const title = (job.title || '').toLowerCase();
  const summary = (job.summary || '').toLowerCase();
  const combined = `${title} ${summary}`;

  let score = 0;
  const matchedPrimary = [];

  for (const kw of primary) {
    if (combined.includes(kw)) {
      matchedPrimary.push(kw);
      score += kw.length > 10 ? 12 : kw.length > 6 ? 8 : 5;
    }
  }

  // Title word bonus
  let titleMatches = 0;
  for (const w of titleWords) {
    if (title.includes(w)) titleMatches++;
  }
  if (titleMatches >= 2) score += 8;
  else if (titleMatches === 1) score += 4;

  // Seniority alignment
  const seniority = titleSeniority(title);
  if (seniority === 'open') score += 5;
  else if (seniority === 'mid' && candidateYears >= 2) score += 3;

  return { score: Math.min(score, 100), matchedPrimary: matchedPrimary.slice(0, 5) };
}

// ---- LLM batch scoring ----
async function llmBatchScore(batch, profile, candidateYears, apiKey) {
  const skills = (profile.skills || []).slice(0, 15).join(', ');
  const headline = profile.headline || 'Professional';
  const industry = profile.industry || '';

  const jobsText = batch.map((j, i) =>
    `JOB ${i + 1}:\nTitle: ${j.title || '?'}\nCompany: ${j.company || '?'}\nSummary: ${(j.summary || '').slice(0, 300)}`
  ).join('\n\n');

  const industryNote = industry ? `\n- Industry: ${industry}` : '';

  const prompt = `You are a job matching expert. Score these ${batch.length} jobs for this candidate.

Candidate profile:
- Headline: ${headline}${industryNote}
- Skills: ${skills}
- Experience: ~${candidateYears} years

Jobs to score:
${jobsText}

SCORING RULES (0-100):
- 80-100: Strong match — same industry, relevant title, skills overlap significantly
- 60-79: Good match — related role, some skills overlap
- 40-59: Weak match — tangentially related
- 0-39: No match — completely different field

IMPORTANT:
- Consider the candidate's INDUSTRY (${industry || 'general'})
- Score based on whether the candidate would ACTUALLY apply and be considered

Return ONLY a JSON array of ${batch.length} integers, nothing else.
Example: [75, 60, 45, 90]

Scores:`;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    const data = await res.json();
    let text = (data.choices?.[0]?.message?.content || '').trim();
    text = text.replace(/^```(?:json)?\s*/g, '').replace(/\s*```$/g, '');

    const scores = JSON.parse(text);
    if (!Array.isArray(scores)) throw new Error('Not an array');

    // Pad/truncate to match batch size
    while (scores.length < batch.length) scores.push(50);
    return scores.slice(0, batch.length).map(s => Math.max(0, Math.min(100, Math.round(s))));
  } catch (e) {
    console.error('LLM scoring failed:', e.message);
    return batch.map(() => 50); // fallback
  }
}

// ---- Company diversity ----
function enforceCompanyDiversity(matches) {
  const companyCounts = {};
  return matches.filter(m => {
    const c = (m.company || 'Unknown').toLowerCase();
    companyCounts[c] = (companyCounts[c] || 0) + 1;
    return companyCounts[c] <= MAX_PER_COMPANY;
  });
}

// ---- Is local job ----
function isLocalJob(job, countryAliases) {
  const text = `${job.title} ${job.summary} ${job.company} ${job.source} ${job.location}`.toLowerCase();
  if (countryAliases.some(a => text.includes(a))) return true;
  const source = (job.source || '').toLowerCase();
  if (['google jobs', 'linkedin', 'naukri', 'lever', 'indeed'].some(s => source.includes(s))) return true;
  return false;
}

// ---- Main matching pipeline ----
export async function matchJobs(jobs, profile, apiKeys = {}, onProgress) {
  const candidateYears = estimateYears(profile);
  const { primary, titleWords } = extractKeywords(profile);
  const userCountry = (profile.country || '').toLowerCase();
  const userState = (profile.state || '').toLowerCase();

  // Build country aliases
  const countryAliases = [userCountry].filter(Boolean);
  if (userState && userState !== 'any') {
    const cityMatch = userState.match(/\(([^)]+)\)/);
    if (cityMatch) {
      for (const city of cityMatch[1].split('/')) countryAliases.push(city.trim().toLowerCase());
    }
  }
  // Common India cities
  if (userCountry === 'india') {
    countryAliases.push('bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad', 'pune', 'chennai');
  }

  onProgress?.(`Scoring ${jobs.length} jobs locally (${primary.size} keywords)...`);

  // Phase 1: Local scoring
  const scoredJobs = [];
  let filtered = { nonEnglish: 0, tooSenior: 0, lowScore: 0 };

  for (const job of jobs) {
    if (isNonEnglish(job.title, job.summary)) { filtered.nonEnglish++; continue; }
    if (candidateYears < 3 && titleSeniority(job.title) === 'senior') { filtered.tooSenior++; continue; }

    const local = scoreLocally(job, primary, titleWords, candidateYears);
    if (local.score < MATCH_THRESHOLD) { filtered.lowScore++; continue; }

    const isLocal = isLocalJob(job, countryAliases);
    const boostedScore = isLocal ? Math.min(100, local.score + 20) : local.score;

    scoredJobs.push({ ...job, _localScore: boostedScore, _originalScore: local.score, _isLocal: isLocal });
  }

  scoredJobs.sort((a, b) => b._localScore - a._localScore);

  onProgress?.(`Phase 1: ${scoredJobs.length} passed (${filtered.lowScore} filtered, ${filtered.tooSenior} too senior)`);

  if (!scoredJobs.length) return [];

  // Phase 2: LLM scoring for top candidates
  const topCandidates = scoredJobs.slice(0, MAX_LLM_CANDIDATES);
  const apiKey = apiKeys.OPENROUTER_KEY;

  if (!apiKey) {
    onProgress?.('No API key — using local scores only');
    return topCandidates
      .filter(j => j._localScore >= 60)
      .slice(0, MAX_MATCHES)
      .map(j => ({ ...j, match_score: j._localScore }));
  }

  onProgress?.(`Sending top ${topCandidates.length} to LLM for scoring...`);

  const allResults = [];
  let apiCalls = 0;

  for (let i = 0; i < topCandidates.length; i += LLM_BATCH_SIZE) {
    const batch = topCandidates.slice(i, i + LLM_BATCH_SIZE);
    const bn = Math.floor(i / LLM_BATCH_SIZE) + 1;

    onProgress?.(`Batch ${bn}: scoring ${batch.length} jobs...`);

    const scores = await llmBatchScore(batch, profile, candidateYears, apiKey);
    apiCalls++;

    for (let j = 0; j < batch.length; j++) {
      const localScore = batch[j]._localScore;
      const llmScore = scores[j];
      let combined = Math.round(localScore * 0.4 + llmScore * 0.6);

      // Source priority boost
      const source = (batch[j].source || '').toLowerCase();
      const prioritySources = ['google jobs', 'indeed', 'naukri', 'linkedin', 'glassdoor'];
      if (prioritySources.some(s => source.includes(s))) combined = Math.min(combined + 8, 100);

      // Location boost
      if (userCountry && userCountry !== 'remote only') {
        const jobText = `${batch[j].title} ${batch[j].summary} ${batch[j].location}`.toLowerCase();
        if (countryAliases.some(a => jobText.includes(a))) combined = Math.min(combined + 8, 100);
      }

      allResults.push({ ...batch[j], match_score: combined, _llmScore: llmScore });
    }

    if (i + LLM_BATCH_SIZE < topCandidates.length) {
      await new Promise(r => setTimeout(r, 600));
    }
  }

  // Phase 3: Filter + diversify
  for (const threshold of [70, 65, 60]) {
    const matches = allResults.filter(j => j.match_score >= threshold);
    if (matches.length > 0) {
      matches.sort((a, b) => b.match_score - a.match_score);
      const diverse = enforceCompanyDiversity(matches);

      onProgress?.(`✅ ${diverse.length} matches (threshold ${threshold}%, ${apiCalls} API calls)`);

      // Clean internal fields
      return diverse.slice(0, MAX_MATCHES).map(j => {
        const { _localScore, _originalScore, _isLocal, _llmScore, ...clean } = j;
        return clean;
      });
    }
  }

  onProgress?.('No strong matches found');
  return [];
}
