import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import {
  fetchReviews, triggerAudit, applyIssueFix, sendChatQuestion,
  setSelectedReviewId, toggleFileExpansion, setChatOpen,
  setChatInput, addLocalChatMessage, clearTriggerStatus
} from './store/reviewsSlice';

function App() {
  const dispatch = useDispatch();

  // Data State
  const {
    items: reviews, loading, selectedReviewId, expandedFiles
  } = useSelector((state) => state.reviews);

  // Feature States
  const { triggerStatus, fixStatus, chat } = useSelector((state) => state.reviews);

  // Manual trigger form state (kept local as it's purely input-based)
  const [triggerOwner, setTriggerOwner] = useState('');
  const [triggerRepo, setTriggerRepo] = useState('');
  const [triggerPR, setTriggerPR] = useState('');

  const selectedReview = reviews.find((r) => r.id === selectedReviewId) || null;

  useEffect(() => {
    dispatch(fetchReviews());
  }, [dispatch]);

  // Auto-poll if the currently selected review is completely PENDING
  useEffect(() => {
    if (selectedReview?.status === 'PENDING') {
      const interval = setInterval(() => {
        dispatch(fetchReviews());
      }, 3000); // Poll every 3 seconds
      return () => clearInterval(interval);
    }
  }, [dispatch, selectedReview?.status]);

  const handleApplyFix = (issue) => {
    dispatch(applyIssueFix({
      owner: selectedReview.owner,
      repo: selectedReview.repo,
      pullNumber: selectedReview.number,
      issueId: issue.id,
      filename: issue.file,
      oldSnippet: issue.codeSnippet,
      newSnippet: issue.aiFixCode || issue.fixCode
    }));
  };

  const handleTriggerReview = (e) => {
    e.preventDefault();
    dispatch(triggerAudit({
      owner: triggerOwner.trim(),
      repo: triggerRepo.trim(),
      pullNumber: Number(triggerPR)
    }));
  };

  const handleSendChat = (e) => {
    e.preventDefault();
    if (!chat.input.trim() || chat.isSending) return;

    dispatch(addLocalChatMessage({ role: 'user', text: chat.input }));
    dispatch(sendChatQuestion({
      owner: selectedReview.owner,
      repo: selectedReview.repo,
      pullNumber: selectedReview.number,
      question: chat.input
    }));
    dispatch(setChatInput(''));
  };

  return (
    <div className="min-h-screen p-4 md:p-8 animate-fade-in">
      <div className="mx-auto max-w-7xl">
        <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold tracking-tight">
              <span className="text-gradient">PR Insights</span>
            </h1>
            <p className="text-slate-400 max-w-md">
              Intelligent code analysis for GitHub Pull Requests. Detects issues, risk scoring, and AI-powered fixes.
            </p>
          </div>
        </header>

        {/* ── Manual PR Trigger ── */}
        <section className="glass-panel mb-8 p-6 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl -mr-20 -mt-20 pointer-events-none"></div>

          <div className="relative z-10 flex flex-col items-center justify-center text-center gap-8">
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-slate-100">Analyze New Pull Request</h2>
              <p className="text-sm text-slate-400">Enter PR details below to trigger an automated code review engine.</p>
            </div>

            <form onSubmit={handleTriggerReview} className="flex flex-wrap items-center justify-center gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Owner</label>
                <input
                  type="text"
                  placeholder="octocat"
                  value={triggerOwner}
                  onChange={(e) => setTriggerOwner(e.target.value)}
                  required
                  className="w-40 rounded-xl border border-slate-700/50 bg-slate-950/50 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-700 outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 transition-all shadow-inner"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Repository</label>
                <input
                  type="text"
                  placeholder="hello-world"
                  value={triggerRepo}
                  onChange={(e) => setTriggerRepo(e.target.value)}
                  required
                  className="w-48 rounded-xl border border-slate-700/50 bg-slate-950/50 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-700 outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 transition-all shadow-inner"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">PR #</label>
                <input
                  type="number"
                  placeholder="42"
                  value={triggerPR}
                  onChange={(e) => setTriggerPR(e.target.value)}
                  required
                  className="w-24 rounded-xl border border-slate-700/50 bg-slate-950/50 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-700 outline-none focus:border-emerald-500/50 focus:ring-4 focus:ring-emerald-500/10 transition-all shadow-inner"
                />
              </div>
              <div className="space-y-2">
                <div className="text-xs font-bold text-transparent select-none uppercase tracking-wider ml-1">Spacer</div>
                <button
                  type="submit"
                  disabled={triggerStatus.loading}
                  className="h-[42px] group relative inline-flex items-center justify-center overflow-hidden rounded-xl bg-emerald-500 px-8 text-sm font-bold text-slate-950 transition-all hover:bg-emerald-400 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-4 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 shadow-lg shadow-emerald-500/20"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    {triggerStatus.loading ? 'Analyzing...' : <>Run Analysis <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg></>}
                  </span>
                </button>
              </div>
            </form>
          </div>

          {(triggerStatus.error || triggerStatus.success) && (
            <div className={`mt-6 px-4 py-3 rounded-xl border ${triggerStatus.error ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'} text-sm flex items-center justify-between gap-3 animate-fade-in`}>
              <div className="flex items-center gap-3">
                {triggerStatus.error ? '⚠️' : '✅'} {triggerStatus.error || triggerStatus.success}
              </div>
              <button onClick={() => dispatch(clearTriggerStatus())} className="opacity-50 hover:opacity-100 transition-opacity">✕</button>
            </div>
          )}
        </section>

        <main className="grid gap-8 lg:grid-cols-[380px_1fr]">
          {/* ── Left Side: PR Selection ── */}
          <aside className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-200">Recent Audits</h3>
              <button
                onClick={() => dispatch(fetchReviews())}
                disabled={loading}
                className="text-xs font-medium text-emerald-500 hover:text-emerald-400 flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <svg className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                Sync
              </button>
            </div>

            <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2 custom-scrollbar">
              {loading && !reviews.length ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-24 glass-panel rounded-2xl animate-pulse"></div>
                ))
              ) : reviews.length === 0 ? (
                <div className="glass-panel p-8 text-center rounded-2xl">
                  <p className="text-sm text-slate-500 italic">No reviews found yet.</p>
                </div>
              ) : (
                reviews.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => dispatch(setSelectedReviewId(r.id))}
                    className={`w-full group text-left glass-card p-4 rounded-2xl flex flex-col gap-3 ${selectedReviewId === r.id ? 'ring-2 ring-emerald-500/40 bg-emerald-500/5' : ''}`}
                  >
                    <div className="flex justify-between items-start gap-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-100 group-hover:text-emerald-400 transition-colors uppercase tracking-tight truncate max-w-[180px]">
                          {r.owner}/{r.repo}
                        </div>
                        <div className="text-xs text-slate-500 font-medium">Pull Request #{r.number}</div>
                      </div>
                      <div className={`px-2 py-0.5 rounded-lg text-[0.65rem] font-bold uppercase tracking-wider ${r.summary.riskScore > 10 ? 'bg-rose-500/20 text-rose-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                        Risk {r.summary.riskScore}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-rose-500"></div>
                        <span className="text-[0.7rem] font-medium text-slate-400">{r.summary.severityDistribution.HIGH}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>
                        <span className="text-[0.7rem] font-medium text-slate-400">{r.summary.severityDistribution.MEDIUM}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500"></div>
                        <span className="text-[0.7rem] font-medium text-slate-400">{r.summary.severityDistribution.LOW}</span>
                      </div>
                      <div className="ml-auto text-[0.65rem] text-slate-600 font-mono">
                        {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* ── Right Side: Review Details ── */}
          <section className="space-y-6">
            {!selectedReview ? (
              <div className="h-full flex flex-col items-center justify-center glass-panel rounded-3xl p-12 text-center text-slate-500 space-y-4">
                <div className="w-16 h-16 rounded-3xl bg-slate-900 flex items-center justify-center text-3xl opacity-50">📂</div>
                <h3 className="text-lg font-medium text-slate-400">Select an Audit to View Details</h3>
                <p className="max-w-xs text-sm">Choose a pull request from the list to see detected issues and suggested fixes.</p>
              </div>
            ) : selectedReview.status === 'PENDING' ? (
              <div className="h-full min-h-[400px] flex flex-col items-center justify-center glass-panel rounded-3xl p-12 text-center space-y-6">
                <div className="relative">
                  <div className="absolute inset-0 bg-emerald-500/20 rounded-full blur-xl scale-150 animate-pulse"></div>
                  <div className="relative h-16 w-16 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin"></div>
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-semibold text-slate-200">Analysis Underway</h3>
                  <p className="text-sm text-slate-500 max-w-sm">We're auditing the code and generating AI suggestions. This usually takes 15-30 seconds.</p>
                </div>
                <button onClick={() => dispatch(fetchReviews())} className="px-6 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-semibold text-slate-200 hover:bg-slate-800 transition-all">Check Status</button>
              </div>
            ) : (
              <div className="space-y-6 animate-fade-in">
                {/* Review Header Stats */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-gradient-premium flex items-center justify-center text-xl">🛡️</div>
                    <div>
                      <h2 className="text-lg font-semibold text-slate-100 uppercase tracking-tight">{selectedReview.owner}/{selectedReview.repo}</h2>
                      <p className="text-xs text-slate-500 font-medium">Pull Request #{selectedReview.number} • Audit Completed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="glass-panel px-3 py-1.5 rounded-xl border-emerald-500/20 text-[0.7rem] font-semibold text-emerald-400">
                      {selectedReview.files.length} Files
                    </div>
                    <div className="glass-panel px-3 py-1.5 rounded-xl border-sky-500/20 text-[0.7rem] font-semibold text-sky-400">
                      {selectedReview.summary.totalIssues} Violations
                    </div>
                    <button
                      onClick={() => dispatch(setChatOpen(!chat.isOpen))}
                      className={`px-4 py-1.5 rounded-xl text-[0.7rem] font-bold transition-all shadow-lg flex items-center gap-2 ${chat.isOpen ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
                    >
                      <span className="text-sm">💬</span>
                      {chat.isOpen ? 'Close Chat' : 'Ask AI about this PR'}
                    </button>
                  </div>
                </div>

                {/* Rejection Banner */}
                {selectedReview.githubReviewStatus === 'REJECTED' && (
                  <div className="bg-rose-500/10 border border-rose-500/30 p-5 rounded-3xl flex items-start gap-4 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none"></div>
                    <div className="w-10 h-10 rounded-xl bg-rose-500/20 flex items-center justify-center text-xl">🚫</div>
                    <div className="space-y-3 flex-1">
                      <div>
                        <h4 className="font-bold text-rose-300">Automated Rejection Triggered</h4>
                        <p className="text-sm text-rose-200/70 mt-1">This PR exceeded the safety thresholds. Changes have been requested automatically on GitHub.</p>
                      </div>
                      {selectedReview.githubReviewUrl && (
                        <a
                          href={selectedReview.githubReviewUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500 text-rose-950 font-bold text-xs transition hover:bg-rose-400"
                        >
                          View Discussion on GitHub
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                      )}
                    </div>
                  </div>
                )}

                <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
                  {/* Main Issues Area */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest ml-1">Detected Vulnerabilities</h4>

                    {selectedReview.issues.length === 0 ? (
                      <div className="glass-panel p-10 rounded-3xl text-center space-y-3">
                        <div className="text-4xl">✨</div>
                        <h5 className="font-semibold text-slate-200">Zero Issues Detected</h5>
                        <p className="text-sm text-slate-500">This pull request meets all the configured safety and quality checks.</p>
                      </div>
                    ) : (
                      selectedReview.issues.map((issue) => (
                        <article key={issue.id} className="glass-panel p-5 rounded-3xl space-y-4 animate-fade-in border-l-4 border-l-slate-700/50 hover:border-l-emerald-500/50 transition-all">
                          <div className="flex justify-between items-start gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className={`w-2 h-2 rounded-full ${issue.severity === 'HIGH' ? 'bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.4)]' : issue.severity === 'MEDIUM' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.4)]' : 'bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.4)]'}`}></span>
                                <span className="text-[0.65rem] font-bold uppercase tracking-widest text-slate-400">{issue.category} · {issue.type}</span>
                              </div>
                              <h5 className="text-sm font-semibold text-slate-100">{issue.message}</h5>
                            </div>
                            <div className={`px-2 py-1 rounded-lg text-[0.6rem] font-bold uppercase ${issue.severity === 'HIGH' ? 'bg-rose-500/10 text-rose-400' : issue.severity === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400' : 'bg-sky-500/10 text-sky-400'}`}>
                              {issue.severity}
                            </div>
                          </div>

                          {issue.codeSnippet && (
                            <div className="space-y-2">
                              <div className="text-[0.65rem] font-bold text-slate-600 uppercase ml-1">Vulnerable Context</div>
                              <div className="rounded-2xl bg-slate-950 p-4 border border-slate-800/50 relative group">
                                <div className="absolute top-0 right-0 p-2 opacity-30">
                                  <svg className="w-4 h-4 text-rose-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                </div>
                                <pre className="text-[0.7rem] text-slate-300 leading-6 overflow-x-auto custom-scrollbar"><code>{issue.codeSnippet}</code></pre>
                              </div>
                            </div>
                          )}

                          {issue.aiExplanation && (
                            <div className="bg-amber-500/5 border border-amber-500/10 p-4 rounded-2xl space-y-1">
                              <div className="text-[0.65rem] font-bold text-amber-500/60 uppercase">Impact Analysis</div>
                              <p className="text-xs text-slate-300 leading-relaxed">{issue.aiExplanation}</p>
                            </div>
                          )}

                          {(issue.aiFixCode || issue.fixCode) && (
                            <div className="space-y-4 pt-2">
                              <div className="flex items-center gap-2">
                                <div className="h-[1px] flex-1 bg-slate-800"></div>
                                <span className="text-[0.6rem] font-bold text-emerald-500 uppercase tracking-widest px-2">Solution Recommendation</span>
                                <div className="h-[1px] flex-1 bg-slate-800"></div>
                              </div>
                              <div className="rounded-2xl bg-emerald-950/20 p-4 border border-emerald-500/20 relative">
                                <div className="absolute top-0 right-0 p-2 opacity-40">
                                  <svg className="w-4 h-4 text-emerald-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                                </div>
                                <div className="flex items-center justify-between mb-2">
                                  <div className="text-[0.7rem] text-emerald-400 font-bold flex items-center gap-1.5 font-mono">
                                    {issue.aiFixCode ? '✨ Generative AI Fix' : '🔧 Template Fix'}
                                  </div>
                                  <button
                                    onClick={() => handleApplyFix(issue)}
                                    disabled={fixStatus.loadingId === issue.id}
                                    className="px-3 py-1 rounded-lg bg-emerald-500 text-slate-950 text-[0.65rem] font-bold hover:bg-emerald-400 disabled:opacity-50 transition-all flex items-center gap-1.5"
                                  >
                                    {fixStatus.loadingId === issue.id ? 'Fixing...' : 'Apply AI Fix'}
                                  </button>
                                </div>
                                {fixStatus.loadingId === null && fixStatus.message && !fixStatus.error && selectedReviewId === issue.reviewId && (
                                  <div className="mb-3 py-1.5 px-3 rounded-lg text-[0.65rem] font-medium border bg-emerald-500/10 border-emerald-500/20 text-emerald-300">
                                    ✅ {fixStatus.message}
                                  </div>
                                )}
                                {fixStatus.error && fixStatus.loadingId === null && (
                                  <div className="mb-3 py-1.5 px-3 rounded-lg text-[0.65rem] font-medium border bg-rose-500/10 border-rose-500/20 text-rose-300">
                                    ⚠️ {fixStatus.error}
                                  </div>
                                )}
                                <pre className="text-[0.7rem] text-emerald-100 leading-6 overflow-x-auto custom-scrollbar"><code>{issue.aiFixCode || issue.fixCode}</code></pre>
                              </div>

                              {issue.aiSuggestedTests && (
                                <div className="space-y-4 pt-2 group/tests">
                                  <div className="flex items-center gap-2">
                                    <div className="h-[1px] flex-1 bg-slate-800"></div>
                                    <span className="text-[0.6rem] font-bold text-sky-500 uppercase tracking-widest px-2">Suggested Unit Tests</span>
                                    <div className="h-[1px] flex-1 bg-slate-800"></div>
                                  </div>
                                  <div className="rounded-2xl bg-sky-950/20 p-4 border border-sky-500/20 relative">
                                    <div className="absolute top-0 right-0 p-2 opacity-40">
                                      <svg className="w-4 h-4 text-sky-500" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" /></svg>
                                    </div>
                                    <div className="text-[0.7rem] text-sky-400 font-bold mb-2 flex items-center gap-1.5 font-mono">
                                      🧪 Automated Test Suite
                                    </div>
                                    <pre className="text-[0.7rem] text-sky-100 leading-6 overflow-x-auto custom-scrollbar"><code>{issue.aiSuggestedTests}</code></pre>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </article>
                      ))
                    )}
                  </div>

                  {/* Right Sidebar Audit Meta */}
                  <aside className="space-y-6">
                    <div className="sticky top-8 space-y-6">
                      <div className="glass-panel p-5 rounded-3xl space-y-4">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Changed Assets</h4>
                        <div className="space-y-2">
                          {selectedReview.files.map((file) => (
                            <div key={file.filename} className="bg-slate-900/40 border border-slate-800/50 p-3 rounded-2xl group hover:border-emerald-500/30 transition-all">
                              <div className="flex justify-between items-center mb-2">
                                <span className="text-[0.65rem] font-mono text-slate-300 truncate max-w-[150px]">{file.filename}</span>
                                <span className={`text-[0.55rem] font-bold uppercase px-1.5 py-0.5 rounded ${file.status === 'modified' ? 'text-sky-400 bg-sky-500/10' : file.status === 'added' ? 'text-emerald-400 bg-emerald-500/10' : file.status === 'deleted' ? 'text-rose-400 bg-rose-500/10' : 'text-amber-400 bg-amber-500/10'}`}>{file.status}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <div className="flex gap-2 text-[0.6rem] font-bold">
                                  <span className="text-emerald-500">+{file.additions}</span>
                                  <span className="text-rose-500">-{file.deletions}</span>
                                </div>
                                <button onClick={() => dispatch(toggleFileExpansion(file.filename))} className="text-[0.65rem] text-slate-500 hover:text-slate-200 transition-colors">
                                  {expandedFiles[file.filename] ? 'Close Diff' : 'View Diff'}
                                </button>
                              </div>
                              {expandedFiles[file.filename] && file.patch && (
                                <pre className="mt-3 p-2 bg-slate-950 rounded-xl text-[0.6rem] text-slate-400 overflow-x-auto custom-scrollbar leading-5"><code>{file.patch}</code></pre>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </aside>
                </div>

                {/* ── Contextual Chat Sidebar ── */}
                {chat.isOpen && (
                  <div className="fixed top-0 right-0 h-screen w-full sm:w-96 bg-slate-950/80 backdrop-blur-2xl border-l border-slate-800 shadow-[20px_0_50px_rgba(0,0,0,0.5)] z-50 flex flex-col animate-slide-in-right">
                    <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-emerald-500/10 to-transparent">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-emerald-500/20 flex items-center justify-center text-lg">🤖</div>
                        <div>
                          <h3 className="text-sm font-bold text-slate-100 uppercase tracking-tighter">PR Assistant</h3>
                          <p className="text-[0.6rem] font-bold text-emerald-500 uppercase">Context Aware Chat</p>
                        </div>
                      </div>
                      <button onClick={() => dispatch(setChatOpen(false))} className="text-slate-500 hover:text-slate-200 transition-colors">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                      {chat.messages.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                          <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-2xl">⚡</div>
                          <p className="text-xs text-slate-400 max-w-[200px]">Ask me anything about the changes in this pull request.</p>
                        </div>
                      )}
                      {chat.messages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed ${msg.role === 'user' ? 'bg-emerald-500 text-slate-950 font-medium ml-4' : 'bg-slate-900 border border-slate-800 text-slate-300 mr-4'}`}>
                            {msg.text}
                          </div>
                        </div>
                      ))}
                      {chat.isSending && (
                        <div className="flex justify-start">
                          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex gap-1 items-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce"></div>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.1s]"></div>
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-bounce [animation-delay:-0.2s]"></div>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="p-6 border-t border-slate-800 bg-slate-950/50">
                      <form onSubmit={handleSendChat} className="relative">
                        <input
                          type="text"
                          placeholder="Type your question..."
                          value={chat.input}
                          onChange={(e) => dispatch(setChatInput(e.target.value))}
                          disabled={chat.isSending}
                          className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50 transition-all pr-12 placeholder-slate-600"
                        />
                        <button
                          type="submit"
                          disabled={chat.isSending || !chat.input.trim()}
                          className="absolute right-2 top-1.5 w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 hover:bg-emerald-400 transition-colors disabled:opacity-50"
                        >
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        </main>

        <footer className="mt-20 py-8 border-t border-slate-800/50 flex flex-col md:flex-row items-center justify-between gap-4 text-slate-500 text-xs font-medium">
          <span>© 2026 PR Insights Engine</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
