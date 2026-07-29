async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    // 세션 만료 → AuthProvider 가 받아서 랜딩 화면으로 전환
    window.dispatchEvent(new Event('auth:expired'));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

export const api = {
  // 단어장
  getSets: () => request('/api/sets'),
  createSet: (name) => request('/api/sets', { method: 'POST', body: JSON.stringify({ name }) }),
  renameSet: (id, name) => request(`/api/sets/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteSet: (id) => request(`/api/sets/${id}`, { method: 'DELETE' }),
  getSet: (id) => request(`/api/sets/${id}`),

  // 단어
  addWords: (setId, words) =>
    request(`/api/sets/${setId}/words`, { method: 'POST', body: JSON.stringify({ words }) }),
  updateWord: (id, data) => request(`/api/words/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteWord: (id) => request(`/api/words/${id}`, { method: 'DELETE' }),
  starWord: (id, starred) =>
    request(`/api/words/${id}/star`, { method: 'PATCH', body: JSON.stringify({ starred }) }),

  // 시험 결과
  saveResult: (payload) => request('/api/results', { method: 'POST', body: JSON.stringify(payload) }),
  getResults: (limit) =>
    request(limit ? `/api/results?limit=${encodeURIComponent(limit)}` : '/api/results'),
  getResult: (id) => request(`/api/results/${id}`),
  deleteResult: (id) => request(`/api/results/${id}`, { method: 'DELETE' }),

  // 복습 (SM-2)
  getDueReview: () => request('/api/review/due'),
  submitReview: (items) => request('/api/review', { method: 'POST', body: JSON.stringify({ items }) }),

  // 통계
  getStats: () => request('/api/stats'),

  // 영어 시험 일정
  getExams: (upcomingOnly) => request(upcomingOnly ? '/api/exams?upcoming=1' : '/api/exams'),
  createExam: (data) => request('/api/exams', { method: 'POST', body: JSON.stringify(data) }),
  updateExam: (id, data) =>
    request(`/api/exams/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteExam: (id) => request(`/api/exams/${id}`, { method: 'DELETE' }),
  setExamMine: (id, mine) =>
    request(`/api/exams/${id}/mine`, { method: 'PATCH', body: JSON.stringify({ mine }) }),
  deleteSampleExams: () => request('/api/exams?samples=1', { method: 'DELETE' }),
};
