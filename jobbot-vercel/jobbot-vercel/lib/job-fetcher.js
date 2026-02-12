// lib/job-fetcher.js — Fetch jobs from all sources (ported from Python)

const NETWORK_TIMEOUT = 25000;

// Lever companies (India-focused + global)
const LEVER_COMPANIES = [
  'meesho', 'cred', 'razorpay', 'groww', 'zerodha', 'phonepe',
  'swiggy', 'zomato', 'ola', 'flipkart', 'paytm', 'dream11',
  'slice', 'jupiter', 'fi-money', 'smallcase', 'cleartax',
  'browserstack', 'postman', 'freshworks', 'zoho', 'chargebee',
];

const WWR_FEEDS = [
  'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  'https://weworkremotely.com/categories/remote-customer-support-jobs.rss',
  'https://weworkremotely.com/categories/remote-product-jobs.rss',
  'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  'https://weworkremotely.com/categories/remote-finance-legal-jobs.rss',
  'https://weworkremotely.com/categories/remote-business-exec-management-jobs.rss',
];

const REMOTEOK_FEED = 'https://remoteok.com/remote-jobs.rss';
const JOBICY_FEED = 'https://jobicy.com/feed/newjobs';

// ---- RSS Parser (lightweight, no external dep) ----
function parseRSSItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, 's'));
      return m ? m[1].trim() : '';
    };
    items.push({
      title: get('title'),
      link: get('link'),
      description: get('description'),
      pubDate: get('pubDate'),
    });
  }
  return items;
}

function stripHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function extractCompanyFromTitle(title) {
  if (!title) return ['Unknown', title || ''];
  // "Company: Job Title" or "Company - Job Title"
  for (const sep of [':', ' - ', ' – ', ' | ']) {
    const idx = title.indexOf(sep);
    if (idx > 2 && idx < title.length - 3) {
      return [title.slice(0, idx).trim(), title.slice(idx + sep.length).trim()];
    }
  }
  return ['Unknown', title];
}

// ---- Location tagging ----
const REGION_KEYWORDS = {
  americas: ['americas', 'north america', 'est ', 'pst ', 'cst ', 'us only', 'usa only', 'eastern time', 'pacific time'],
  europe: ['emea', 'europe', 'cet ', 'gmt', 'uk only', 'european hours'],
  asia: ['apac', 'asia', 'ist ', 'india', 'singapore', 'bangalore', 'bengaluru', 'mumbai', 'delhi', 'hyderabad'],
  global: ['anywhere', 'worldwide', 'global', 'any timezone', 'fully remote', 'work from anywhere'],
};

function extractLocationTags(text) {
  if (!text) return ['global'];
  const lower = text.toLowerCase();
  const tags = new Set();
  for (const [region, keywords] of Object.entries(REGION_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) { tags.add(region); break; }
    }
  }
  return tags.size ? [...tags].sort() : ['global'];
}

// ---- Fetch RSS ----
async function fetchRSS(url, sourceName, maxItems = 50) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'JobBot/1.0' },
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const xml = await res.text();
    const items = parseRSSItems(xml);

    return items.slice(0, maxItems).map(item => {
      const [company, title] = extractCompanyFromTitle(item.title);
      const summary = stripHtml(item.description).slice(0, 1000);
      return {
        title: title || item.title,
        company,
        summary,
        apply_url: item.link,
        source: sourceName,
        date_posted: item.pubDate || '',
        location: '',
        location_tags: extractLocationTags(`${title} ${summary}`),
      };
    });
  } catch (e) {
    console.error(`RSS ${sourceName} failed:`, e.message);
    return [];
  }
}

// ---- Fetch Remotive API ----
async function fetchRemotive() {
  try {
    const res = await fetch('https://remotive.com/api/remote-jobs?limit=30', {
      signal: AbortSignal.timeout(NETWORK_TIMEOUT),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.jobs || []).map(j => ({
      title: j.title || '',
      company: j.company_name || 'Unknown',
      summary: stripHtml(j.description || '').slice(0, 1000),
      apply_url: j.url || '',
      source: 'Remotive',
      date_posted: j.publication_date || '',
      location: j.candidate_required_location || '',
      location_tags: extractLocationTags(`${j.title} ${j.description} ${j.candidate_required_location}`),
    }));
  } catch (e) {
    console.error('Remotive failed:', e.message);
    return [];
  }
}

// ---- Fetch Lever ----
async function fetchLever(companies = LEVER_COMPANIES, maxPerCompany = 15) {
  const allJobs = [];
  for (const company of companies) {
    try {
      const res = await fetch(`https://api.lever.co/v0/postings/${company}?mode=json&limit=${maxPerCompany}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const postings = await res.json();
      if (!Array.isArray(postings)) continue;

      for (const p of postings) {
        allJobs.push({
          title: p.text || '',
          company: company.charAt(0).toUpperCase() + company.slice(1),
          summary: stripHtml(p.descriptionPlain || p.description || '').slice(0, 1000),
          apply_url: p.hostedUrl || p.applyUrl || '',
          source: 'Lever',
          date_posted: p.createdAt ? new Date(p.createdAt).toISOString() : '',
          location: (p.categories?.location) || '',
          location_tags: extractLocationTags(`${p.text} ${p.categories?.location || ''}`),
        });
      }
    } catch {
      // skip failed company
    }
  }
  return allJobs;
}

// ---- Fetch SerpAPI (Google Jobs) ----
async function fetchSerpAPI(queries, location, apiKey) {
  if (!apiKey || !queries.length) return [];
  const allJobs = [];
  const seen = new Set();

  for (const q of queries.slice(0, 6)) {
    try {
      const params = new URLSearchParams({
        engine: 'google_jobs',
        q: q.q || q,
        api_key: apiKey,
        num: '10',
      });
      if (q.location || location) params.set('location', q.location || location);

      const res = await fetch(`https://serpapi.com/search.json?${params}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();

      for (const job of (data.jobs_results || [])) {
        const key = `${job.title}__${job.company_name}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        // Determine actual source from extensions
        const via = (job.via || '').replace('via ', '');
        const source = via || 'Google Jobs';

        allJobs.push({
          title: job.title || '',
          company: job.company_name || 'Unknown',
          summary: stripHtml(job.description || '').slice(0, 1000),
          apply_url: job.apply_link || job.related_links?.[0]?.link || '',
          source,
          location: job.location || '',
          date_posted: job.detected_extensions?.posted_at || '',
          location_tags: extractLocationTags(`${job.title} ${job.description} ${job.location}`),
        });
      }

      // Rate limit
      await new Promise(r => setTimeout(r, 1100));
    } catch (e) {
      console.error(`SerpAPI query "${q.q || q}" failed:`, e.message);
    }
  }
  return allJobs;
}

// ---- Fetch JSearch (RapidAPI) ----
async function fetchJSearch(queries, location, apiKey) {
  if (!apiKey || !queries.length) return [];
  const allJobs = [];

  for (const q of queries.slice(0, 5)) {
    try {
      const params = new URLSearchParams({
        query: location ? `${q} in ${location}` : q,
        num_pages: '1',
      });

      const res = await fetch(`https://jsearch.p.rapidapi.com/search?${params}`, {
        headers: {
          'X-RapidAPI-Key': apiKey,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();

      for (const job of (data.data || [])) {
        allJobs.push({
          title: job.job_title || '',
          company: job.employer_name || 'Unknown',
          summary: stripHtml(job.job_description || '').slice(0, 1000),
          apply_url: job.job_apply_link || '',
          source: job.job_publisher || 'JSearch',
          location: [job.job_city, job.job_state, job.job_country].filter(Boolean).join(', '),
          date_posted: job.job_posted_at_datetime_utc || '',
          location_tags: extractLocationTags(`${job.job_title} ${job.job_description} ${job.job_city} ${job.job_country}`),
        });
      }

      await new Promise(r => setTimeout(r, 1200));
    } catch (e) {
      console.error(`JSearch query "${q}" failed:`, e.message);
    }
  }
  return allJobs;
}

// ---- Build queries from profile ----
export function buildQueries(profile) {
  const headline = (profile.headline || '').trim();
  const skills = profile.skills || [];
  const searchTerms = profile.search_terms || [];
  const industry = (profile.industry || '').trim();
  const country = (profile.country || '').trim();
  const state = (profile.state || '').trim();
  const isRemote = ['remote only', 'remote', 'global', ''].includes(country.toLowerCase());

  let location = null;
  if (!isRemote) {
    if (state && state !== 'Any') {
      location = state.replace(/[()]/g, '');
    } else if (country) {
      location = country;
    }
  }

  const queries = [];
  for (const term of searchTerms.slice(0, 5)) queries.push(term);
  if (headline && queries.length < 8) queries.push(headline);
  if (industry && queries.length < 8) queries.push(`${industry} jobs`);
  for (const skill of skills.slice(0, 2)) {
    if (queries.length < 10 && skill.split(' ').length <= 3) queries.push(`${skill} specialist`);
  }

  // Deduplicate
  const seen = new Set();
  const unique = queries.filter(q => {
    const k = q.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return { queries: unique.slice(0, 10), location };
}

// ---- Main fetch function ----
export async function fetchAllJobs(profile, apiKeys = {}, onProgress) {
  const { queries, location } = buildQueries(profile);
  const country = (profile.country || '').toLowerCase();
  const prioritizeLocal = country && !['remote only', 'remote', 'global'].includes(country);

  onProgress?.('Fetching from RSS feeds...');

  // Parallel fetches for speed
  const feedsToFetch = prioritizeLocal ? WWR_FEEDS.slice(0, 3) : WWR_FEEDS;

  const [wwrResults, remoteOkResult, jobicyResult, remotiveResult] = await Promise.all([
    Promise.all(feedsToFetch.map(url => fetchRSS(url, 'WeWorkRemotely'))),
    fetchRSS(REMOTEOK_FEED, 'RemoteOK', 100),
    fetchRSS(JOBICY_FEED, 'Jobicy'),
    fetchRemotive(),
  ]);

  let allJobs = [
    ...wwrResults.flat(),
    ...remoteOkResult,
    ...jobicyResult,
    ...remotiveResult,
  ];

  onProgress?.(`RSS: ${allJobs.length} jobs. Fetching Lever...`);

  // Lever (sequential due to rate limiting)
  const leverJobs = await fetchLever();
  allJobs.push(...leverJobs);

  onProgress?.(`+${leverJobs.length} Lever. Fetching Google Jobs...`);

  // SerpAPI / JSearch (need API keys)
  if (queries.length > 0) {
    const serpJobs = await fetchSerpAPI(queries, location, apiKeys.SERPAPI_KEY);
    allJobs.push(...serpJobs);
    onProgress?.(`+${serpJobs.length} SerpAPI.`);

    const jsearchJobs = await fetchJSearch(queries, location, apiKeys.JSEARCH_KEY);
    allJobs.push(...jsearchJobs);
    onProgress?.(`+${jsearchJobs.length} JSearch.`);
  }

  // Deduplicate by URL
  const seenUrls = new Set();
  const unique = allJobs.filter(j => {
    const url = j.apply_url;
    if (!url) return true;
    if (seenUrls.has(url)) return false;
    seenUrls.add(url);
    return true;
  });

  // Source breakdown
  const sources = {};
  for (const j of unique) {
    sources[j.source] = (sources[j.source] || 0) + 1;
  }

  onProgress?.(`Total: ${unique.length} unique jobs`);
  return { jobs: unique, sources, queries };
}
