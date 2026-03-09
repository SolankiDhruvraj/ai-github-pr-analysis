// src/store/reviewsSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// 1. Fetch all reviews
export const fetchReviews = createAsyncThunk('reviews/fetchReviews', async () => {
  const query = `
    query RecentReviews($limit: Int) {
      recentReviews(limit: $limit) {
        id owner repo number status createdAt githubReviewStatus githubReviewUrl
        summary { totalIssues riskScore severityDistribution { HIGH MEDIUM LOW } filesAffected }
        files { filename status additions deletions changes patch }
        issues { id category type severity file message suggestion codeSnippet fixCode aiExplanation aiFixSuggestion aiFixCode aiSuggestedTests }
      }
    }
  `;
  const res = await fetch('/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { limit: 20 } })
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);
  return json.data?.recentReviews ?? [];
});

// 2. Trigger new PR analysis
export const triggerAudit = createAsyncThunk('reviews/triggerAudit', async (payload) => {
  const res = await fetch('/github/trigger', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to trigger');
  return data.review;
});

// 3. Apply AI Fix
export const applyIssueFix = createAsyncThunk('reviews/applyIssueFix', async (payload) => {
  const res = await fetch('/github/apply-fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to apply');
  return { issueId: payload.issueId, success: true };
});

// 4. Send Chat message
export const sendChatQuestion = createAsyncThunk('reviews/sendChatQuestion', async (payload, { signal }) => {
  const res = await fetch('/github/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'AI Error');
  return data.answer;
});

const reviewsSlice = createSlice({
  name: 'reviews',
  initialState: {
    items: [],
    loading: false,
    error: null,
    selectedReviewId: null,
    expandedFiles: {},

    // Trigger state
    triggerStatus: { loading: false, error: null, success: null },

    // Fix state
    fixStatus: { loadingId: null, error: null, message: null },

    // Chat state
    chat: { isOpen: false, messages: [], isSending: false, input: '' }
  },
  reducers: {
    setSelectedReviewId: (state, action) => {
      state.selectedReviewId = action.payload;
    },
    toggleFileExpansion: (state, action) => {
      const filename = action.payload;
      state.expandedFiles[filename] = !state.expandedFiles[filename];
    },
    setChatOpen: (state, action) => {
      state.chat.isOpen = action.payload;
    },
    setChatInput: (state, action) => {
      state.chat.input = action.payload;
    },
    addLocalChatMessage: (state, action) => {
      state.chat.messages.push(action.payload);
    },
    clearTriggerStatus: (state) => {
      state.triggerStatus = { loading: false, error: null, success: null };
    }
  },
  extraReducers: (builder) => {
    builder
      // Fetch
      .addCase(fetchReviews.pending, (state) => { state.loading = true; state.error = null; })
      .addCase(fetchReviews.fulfilled, (state, action) => {
        state.loading = false;
        state.items = action.payload;
        if (action.payload.length && !state.selectedReviewId) {
          state.selectedReviewId = action.payload[0].id;
        }
      })
      .addCase(fetchReviews.rejected, (state, action) => { state.loading = false; state.error = action.error.message; })

      // Trigger
      .addCase(triggerAudit.pending, (state) => { state.triggerStatus.loading = true; state.triggerStatus.error = null; state.triggerStatus.success = null; })
      .addCase(triggerAudit.fulfilled, (state, action) => {
        state.triggerStatus.loading = false;
        state.triggerStatus.success = `Audit triggered for PR #${action.meta.arg.pullNumber}!`;
        state.items.unshift(action.payload);
        state.selectedReviewId = action.payload.id;
      })
      .addCase(triggerAudit.rejected, (state, action) => { state.triggerStatus.loading = false; state.triggerStatus.error = action.error.message; })

      // Fix
      .addCase(applyIssueFix.pending, (state, action) => {
        state.fixStatus.loadingId = action.meta.arg.issueId;
        state.fixStatus.message = 'Applying fix...';
        state.fixStatus.error = null;
      })
      .addCase(applyIssueFix.fulfilled, (state) => {
        state.fixStatus.loadingId = null;
        state.fixStatus.message = 'Fix applied successfully!';
      })
      .addCase(applyIssueFix.rejected, (state, action) => {
        state.fixStatus.loadingId = null;
        state.fixStatus.error = action.error.message;
      })

      // Chat
      .addCase(sendChatQuestion.pending, (state) => { state.chat.isSending = true; })
      .addCase(sendChatQuestion.fulfilled, (state, action) => {
        state.chat.isSending = false;
        state.chat.messages.push({ role: 'ai', text: action.payload });
      })
      .addCase(sendChatQuestion.rejected, (state, action) => {
        state.chat.isSending = false;
        state.chat.messages.push({ role: 'ai', text: `Error: ${action.error.message}` });
      });
  },
});

export const {
  setSelectedReviewId, toggleFileExpansion, setChatOpen,
  setChatInput, addLocalChatMessage, clearTriggerStatus
} = reviewsSlice.actions;

export default reviewsSlice.reducer;
