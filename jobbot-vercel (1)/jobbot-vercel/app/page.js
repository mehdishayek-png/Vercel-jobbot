'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

const COUNTRY_REGIONS = {
  India: ['Any', 'Karnataka (Bangalore)', 'Maharashtra (Mumbai/Pune)', 'Delhi NCR', 'Telangana (Hyderabad)', 'Tamil Nadu (Chennai)', 'West Bengal (Kolkata)', 'Gujarat (Ahmedabad)', 'Uttar Pradesh', 'Rajasthan', 'Kerala', 'Punjab', 'Haryana (Gurgaon)'],
  'United States': ['Any', 'California', 'New York', 'Texas', 'Washington', 'Massachusetts', 'Illinois', 'Florida', 'Colorado', 'Georgia', 'Pennsylvania', 'Virginia'],
  'United Kingdom': ['Any', 'London', 'Manchester', 'Birmingham', 'Edinburgh', 'Bristol', 'Leeds'],
  Canada: ['Any', 'Ontario (Toronto)', 'British Columbia (Vancouver)', 'Quebec (Montreal)', 'Alberta (Calgary)'],
  Germany: ['Any', 'Berlin', 'Munich', 'Hamburg', 'Frankfurt'],
  Australia: ['Any', 'New South Wales (Sydney)', 'Victoria (Melbourne)', 'Queensland (Brisbane)'],
  UAE: ['Any', 'Dubai', 'Abu Dhabi'],
  Singapore: ['Any'],
  'Remote Only': ['Any'],
};
const COUNTRIES = Object.keys(COUNTRY_REGIONS);
const EXP_OPTIONS = ['0–1 years', '1–3 years', '3–6 years', '6–10 years', '10+ years'];

/* Score ring SVG component */
function ScoreRing({ score, size = 42 }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? '#30d158' : score >= 65 ? '#0071e3' : '#ff9f0a';
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="3" />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="3"
        strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)' }} />
      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central"
        fill="var(--text-1)" fontSize="11" fontWeight="700" fontFamily="inherit">{score}</text>
    </svg>
  );
}

/* Chevron icon */
function ChevronDown({ open }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }}>
      <path d="M4 6L8 10L12 6" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export default function Home() {
  const [profile, setProfile] = useState({
    name: '', email: '', headline: '', experience: '3–6 years',
    skills: [], industry: '', search_terms: [],
    country: 'India', state: 'Any',
  });
  const [matches, setMatches] = useState([]);
  const [totalJobs, setTotalJobs] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [sortBy, setSortBy] = useState('score');
  const [expandedJob, setExpandedJob] = useState(null);
  const [coverLetters, setCoverLetters] = useState({});
  const [generatingLetter, setGeneratingLetter] = useState(null);
  const [skillsText, setSkillsText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState('profile');
  const fileRef = useRef(null);

  const updateProfile = (key, val) => setProfile(p => ({ ...p, [key]: val }));

  const handleParseResume = async (file) => {
    if (!file) return;
    setIsParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/parse-resume', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setProfile(prev => ({ ...prev, ...data.profile, country: prev.country, state: prev.state, experience: prev.experience }));
      setSkillsText((data.profile.skills || []).join('\n'));
    } catch (e) { alert(`Parse error: ${e.message}`); }
    finally { setIsParsing(false); }
  };

  const handleSearch = async () => {
    const currentProfile = { ...profile, skills: skillsText.split('\n').map(s => s.trim()).filter(Boolean) };
    if (!currentProfile.skills.length) { alert('Please add skills first'); return; }
    setIsSearching(true);
    setProgress('Initializing pipeline…');
    setProgressPct(5);
    setMatches([]);
    setExpandedJob(null);
    try {
      const res = await fetch('/api/match-jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: currentProfile }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setMatches(data.matches || []);
      setTotalJobs(data.total || 0);
      setProgress(`${data.matches?.length || 0} matches from ${data.total} jobs`);
      setProgressPct(100);
    } catch (e) { setProgress(`Error: ${e.message}`); }
    finally { setIsSearching(false); }
  };

  const handleGenerateLetter = async (job, idx) => {
    setGeneratingLetter(idx);
    try {
      const res = await fetch('/api/cover-letter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job, profile: { ...profile, skills: skillsText.split('\n').filter(Boolean) } }),
      });
      const data = await res.json();
      if (data.letter) setCoverLetters(prev => ({ ...prev, [idx]: data.letter }));
    } catch {}
    finally { setGeneratingLetter(null); }
  };

  const sortedMatches = [...matches].sort((a, b) =>
    sortBy === 'score' ? (b.match_score || 0) - (a.match_score || 0) : 0
  );

  const regions = COUNTRY_REGIONS[profile.country] || ['Any'];

  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file?.type === 'application/pdf') handleParseResume(file);
  }, []);

  return (
    <div className="relative z-[1] min-h-screen">
      {/* ── NAV ── */}
      <nav className="sticky top-0 z-50 backdrop-blur-xl bg-[rgba(245,245,247,0.8)] border-b border-[var(--border)]">
        <div className="max-w-[1400px] mx-auto px-6 h-12 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-[var(--accent)] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="text-[0.9375rem] font-bold tracking-tight" style={{color:'var(--text-1)'}}>JobBot</span>
          </div>
          <div className="flex items-center gap-3">
            {matches.length > 0 && (
              <span className="pill pill-green text-xs">{matches.length} matches</span>
            )}
            <div className="w-8 h-8 rounded-full bg-[rgba(0,0,0,0.04)] border border-[var(--border)] flex items-center justify-center text-xs" style={{color:'var(--text-3)'}}>
              {profile.name ? profile.name.charAt(0).toUpperCase() : '?'}
            </div>
          </div>
        </div>
      </nav>

      {/* ── MAIN ── */}
      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex gap-6 layout-split" style={{ flexDirection: 'row' }}>

          {/* ─── LEFT PANEL ─── */}
          <div className="w-[340px] flex-shrink-0 panel-left">
            <div className="card p-5 sticky top-[72px]">

              {/* Segment control */}
              <div className="seg-control w-full mb-5">
                <button className={`seg-item flex-1 ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>Profile</button>
                <button className={`seg-item flex-1 ${activeTab === 'prefs' ? 'active' : ''}`} onClick={() => setActiveTab('prefs')}>Preferences</button>
              </div>

              {activeTab === 'profile' ? (
                <div className="anim-fade-up">
                  {/* Upload zone */}
                  <div
                    className={`upload-zone mb-5 ${dragOver ? 'dragging' : ''}`}
                    onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={onDrop}
                    onClick={() => fileRef.current?.click()}
                  >
                    <div className="relative z-[1]">
                      <div className="w-11 h-11 mx-auto mb-2.5 rounded-xl bg-[var(--accent-light)] flex items-center justify-center">
                        {isParsing ? (
                          <div className="spinner" />
                        ) : (
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-6Z" stroke="var(--accent)" strokeWidth="1.5"/>
                            <path d="M14 2v6h6" stroke="var(--accent)" strokeWidth="1.5"/>
                          </svg>
                        )}
                      </div>
                      <div className="text-sm font-semibold" style={{color:'var(--text-1)'}}>{isParsing ? 'Analyzing résumé…' : 'Upload résumé'}</div>
                      <div className="text-xs mt-0.5" style={{color:'var(--text-3)'}}>PDF · drop or click to browse</div>
                    </div>
                    <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleParseResume(e.target.files[0])} />
                  </div>

                  {/* Form fields */}
                  <div className="space-y-3.5">
                    <div>
                      <label className="input-label">Name</label>
                      <input className="input-field" value={profile.name} onChange={e => updateProfile('name', e.target.value)} placeholder="Your full name" />
                    </div>
                    <div>
                      <label className="input-label">Professional headline</label>
                      <input className="input-field" value={profile.headline} onChange={e => updateProfile('headline', e.target.value)} placeholder="e.g. Business Operations Lead" />
                    </div>
                    <div>
                      <label className="input-label">Experience</label>
                      <select className="input-field" value={profile.experience} onChange={e => updateProfile('experience', e.target.value)}>
                        {EXP_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="input-label">Skills & search terms</label>
                      <textarea className="input-field" rows={5} value={skillsText} onChange={e => setSkillsText(e.target.value)}
                        placeholder={"payment operations\nfintech\nmerchant onboarding\nAPI integration"} />
                      <p className="text-xs mt-1" style={{color:'var(--text-3)'}}>One per line — parsed from résumé or add manually</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="anim-fade-up">
                  <div className="space-y-3.5">
                    <div>
                      <label className="input-label">Country</label>
                      <select className="input-field" value={profile.country} onChange={e => { updateProfile('country', e.target.value); updateProfile('state', 'Any'); }}>
                        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="input-label">City / Region</label>
                      <select className="input-field" value={profile.state} onChange={e => updateProfile('state', e.target.value)}>
                        {regions.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="input-label">Email (optional)</label>
                      <input className="input-field" type="email" value={profile.email} onChange={e => updateProfile('email', e.target.value)} placeholder="you@example.com" />
                    </div>
                  </div>

                  {/* Active profile summary */}
                  {(profile.headline || skillsText.trim()) && (
                    <div className="card-inset p-3.5 mt-5">
                      <p className="text-xs font-semibold mb-1.5" style={{color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'0.06em'}}>Active profile</p>
                      {profile.headline && <p className="text-sm font-semibold mb-1" style={{color:'var(--text-1)'}}>{profile.headline}</p>}
                      <p className="text-xs" style={{color:'var(--text-2)'}}>
                        {profile.country}{profile.state !== 'Any' ? ` · ${profile.state}` : ''} · {profile.experience}
                      </p>
                      {skillsText.trim() && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {skillsText.split('\n').filter(Boolean).slice(0, 6).map((s, i) => (
                            <span key={i} className="pill pill-blue">{s.trim()}</span>
                          ))}
                          {skillsText.split('\n').filter(Boolean).length > 6 && (
                            <span className="pill" style={{background:'rgba(0,0,0,0.04)', color:'var(--text-3)'}}>+{skillsText.split('\n').filter(Boolean).length - 6}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Search button */}
              <button className="btn-primary w-full mt-5" onClick={handleSearch} disabled={isSearching || !skillsText.trim()}>
                {isSearching ? (
                  <><div className="spinner" style={{borderTopColor:'#fff', borderColor:'rgba(255,255,255,0.3)', width:14, height:14}} /> Searching…</>
                ) : (
                  <>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                    Find matching jobs
                  </>
                )}
              </button>
            </div>
          </div>

          {/* ─── RIGHT PANEL ─── */}
          <div className="flex-1 min-w-0 panel-right">

            {/* Header */}
            <div className="flex items-end justify-between mb-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight" style={{letterSpacing:'-0.03em'}}>
                  {matches.length > 0 ? 'Your matches' : 'Job matches'}
                </h1>
                {totalJobs > 0 && (
                  <p className="text-sm mt-0.5" style={{color:'var(--text-2)'}}>
                    {matches.length} of {totalJobs} jobs scored above threshold
                  </p>
                )}
              </div>
              {sortedMatches.length > 1 && (
                <div className="seg-control">
                  <button className={`seg-item ${sortBy === 'score' ? 'active' : ''}`} onClick={() => setSortBy('score')}>Top match</button>
                  <button className={`seg-item ${sortBy === 'date' ? 'active' : ''}`} onClick={() => setSortBy('date')}>Latest</button>
                </div>
              )}
            </div>

            {/* Progress */}
            {(isSearching || progressPct > 0) && (
              <div className="mb-5 anim-fade-up">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
                {progress && (
                  <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{color:'var(--text-2)'}}>
                    {isSearching && <div className="spinner" />}
                    {progress}
                  </p>
                )}
              </div>
            )}

            {/* Results */}
            <div className="space-y-2.5">
              {sortedMatches.length > 0 ? sortedMatches.map((job, idx) => {
                const score = Math.round(job.match_score || 0);
                const isExpanded = expandedJob === idx;

                return (
                  <div key={idx} className="anim-fade-up" style={{ animationDelay: `${idx * 0.04}s` }}>
                    <div
                      className={`job-row ${isExpanded ? 'expanded' : ''}`}
                      onClick={() => setExpandedJob(isExpanded ? null : idx)}
                    >
                      <div className="flex items-center gap-3.5">
                        <ScoreRing score={score} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[0.9375rem] font-semibold truncate" style={{color:'var(--text-1)'}}>{job.title}</span>
                            <span className="source-chip flex-shrink-0">{(job.source || '').split(' ')[0]}</span>
                          </div>
                          <p className="text-[0.8125rem] truncate" style={{color:'var(--text-2)'}}>
                            {[job.company, job.location].filter(Boolean).join(' · ')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {job.apply_url && (
                            <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="btn-primary no-underline"
                              style={{padding:'0.5rem 1rem', fontSize:'0.8125rem'}}
                              onClick={e => e.stopPropagation()}>
                              Apply
                            </a>
                          )}
                          <ChevronDown open={isExpanded} />
                        </div>
                      </div>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="mt-3.5 pt-3.5 border-t border-[var(--border)] anim-fade-up" onClick={e => e.stopPropagation()}>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs mb-3" style={{color:'var(--text-2)'}}>
                            {job.company && <span className="font-semibold">{job.company}</span>}
                            {job.location && <span>📍 {job.location}</span>}
                            {job.date_posted && <span>📅 {job.date_posted}</span>}
                          </div>
                          {job.summary && (
                            <p className="text-sm leading-relaxed mb-3" style={{color:'var(--text-2)'}}>
                              {job.summary.slice(0, 500)}{job.summary.length > 500 ? '…' : ''}
                            </p>
                          )}
                          <div className="flex gap-2">
                            <button
                              className="btn-secondary"
                              onClick={() => handleGenerateLetter(job, idx)}
                              disabled={generatingLetter === idx}
                            >
                              {generatingLetter === idx ? (
                                <><div className="spinner" style={{width:12,height:12}} /> Writing…</>
                              ) : 'Generate cover letter'}
                            </button>
                            {job.apply_url && (
                              <a href={job.apply_url} target="_blank" rel="noopener noreferrer" className="btn-ghost no-underline">
                                Open listing ↗
                              </a>
                            )}
                          </div>
                          {coverLetters[idx] && (
                            <div className="letter-sheet anim-fade-up">{coverLetters[idx]}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              }) : (
                /* Empty state */
                !isSearching && (
                  <div className="card p-12 text-center anim-fade-up">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-[var(--accent-light)] flex items-center justify-center">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                        <path d="M21 21L16.65 16.65M19 11C19 15.4183 15.4183 19 11 19C6.58172 19 3 15.4183 3 11C3 6.58172 6.58172 3 11 3C15.4183 3 19 6.58172 19 11Z" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                    </div>
                    <h3 className="text-lg font-semibold mb-1">Ready to find matches</h3>
                    <p className="text-sm" style={{color:'var(--text-2)', maxWidth: 320, margin: '0 auto'}}>
                      Upload your résumé or add skills manually, then hit search. We'll scan 8+ job sources and rank the best fits.
                    </p>
                  </div>
                )
              )}
            </div>

            {/* Clear */}
            {matches.length > 0 && (
              <div className="mt-6 flex justify-center">
                <button className="btn-ghost" onClick={() => { setMatches([]); setTotalJobs(0); setProgress(''); setProgressPct(0); setExpandedJob(null); }}>
                  Clear all results
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
