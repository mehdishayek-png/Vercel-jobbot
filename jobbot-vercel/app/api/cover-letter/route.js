// app/api/cover-letter/route.js
import { NextResponse } from 'next/server';

export const maxDuration = 15;

export async function POST(request) {
  try {
    const { job, profile } = await request.json();
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured on server' }, { status: 500 });

    const skills = (profile.skills || []).slice(0, 20).join(', ');

    const prompt = `Write a concise, tailored cover letter.

Rules:
- 2 paragraphs, 70-90 words
- Professional but human tone
- No placeholders or template language
- Focus on relevant skills and experience

Candidate:
Name: ${profile.name || 'Candidate'}
Headline: ${profile.headline || 'Professional'}
Skills: ${skills}

Job:
Title: ${job.title || '?'}
Company: ${job.company || '?'}
Description: ${(job.summary || '').slice(0, 1500)}

Write the cover letter:`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 250,
      }),
    });

    const data = await res.json();
    let letter = (data.choices?.[0]?.message?.content || '').trim();
    letter = letter.replace(/\[Your Name\]/g, profile.name || 'Candidate');
    letter = letter.replace(/\[Company Name\]/g, job.company || '');

    return NextResponse.json({ letter });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
