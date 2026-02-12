// lib/resume-parser.js — Parse resume PDF + extract profile via LLM

export async function parseResumePDF(pdfBuffer, apiKey) {
  // Use pdf-parse to extract text from PDF
  // In browser context, we'll send the file to the API route
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(pdfBuffer);
  const text = data.text || '';

  if (!text.trim()) throw new Error('Could not extract text from PDF');

  // Use LLM to extract structured profile
  const profile = await extractProfileWithLLM(text, apiKey);
  return profile;
}

export async function extractProfileWithLLM(text, apiKey) {
  const prompt = `Extract the following from this resume and return ONLY valid JSON:

1. name: Full name of the candidate
2. headline: Current job title or professional headline
3. skills: List of 8-15 SPECIFIC, SEARCHABLE professional skills
4. industry: The primary industry/domain (e.g. "fintech", "e-commerce", "healthcare")
5. search_terms: 3-5 job title variations this person would search for on job boards

SKILLS RULES:
- Extract DOMAIN-SPECIFIC skills, NOT generic ones
- GOOD: "payment gateway integration", "UPI services", "merchant onboarding", "digital payments"
- BAD: "ai modules", "api mappings", "modules" (too vague)
- Include specific tools/platforms: "Salesforce", "JIRA", "SAP"
- DO NOT include soft skills or generic office tools
- Each skill should realistically appear in a job posting

SEARCH_TERMS: job TITLES the person would search for, not skills.

Return ONLY: {"name": "...", "headline": "...", "skills": [...], "industry": "...", "search_terms": [...]}

Resume text:
${text.slice(0, 6000)}

JSON:`;

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
      max_tokens: 600,
    }),
  });

  const data = await res.json();
  let responseText = (data.choices?.[0]?.message?.content || '').trim();

  // Clean markdown fences
  responseText = responseText.replace(/^```(?:json)?\n?/g, '').replace(/\n?```$/g, '');

  const profile = JSON.parse(responseText);

  // Validate and clean
  profile.name = profile.name || 'Candidate';
  profile.headline = profile.headline || '';
  profile.industry = profile.industry || '';
  profile.skills = Array.isArray(profile.skills)
    ? [...new Set(profile.skills.map(s => s.trim().toLowerCase()).filter(Boolean))].sort()
    : [];
  profile.search_terms = Array.isArray(profile.search_terms)
    ? profile.search_terms.filter(s => typeof s === 'string' && s.trim()).slice(0, 5)
    : [];

  return profile;
}
