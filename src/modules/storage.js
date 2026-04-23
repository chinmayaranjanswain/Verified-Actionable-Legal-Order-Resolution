// V.A.L.O.R. — localStorage CRUD + Colab Config

const STORAGE_KEY = 'valor_records';
const COLAB_URL_KEY = 'valor_colab_url';

export function getRecords() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveRecord(record) {
  const records = getRecords();
  record.id = record.id || crypto.randomUUID();
  record.createdAt = record.createdAt || new Date().toISOString();
  record.updatedAt = new Date().toISOString();
  records.push(record);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return record;
}

export function updateRecord(id, updates) {
  const records = getRecords();
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return null;
  records[idx] = { ...records[idx], ...updates, updatedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  return records[idx];
}

export function deleteRecord(id) {
  const records = getRecords().filter(r => r.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export function getStats() {
  const records = getRecords();
  return {
    total: records.length,
    approved: records.filter(r => r.status === 'approved').length,
    pending: records.filter(r => r.status === 'pending').length,
    rejected: records.filter(r => r.status === 'rejected').length,
    overdue: records.filter(r => {
      if (!r.deadlineDate || r.status === 'completed') return false;
      return new Date(r.deadlineDate) < new Date();
    }).length
  };
}

// ── Colab URL Persistence ────────────────────────────────────────
export function getColabUrl() {
  // Priority: localStorage > env variable
  const stored = localStorage.getItem(COLAB_URL_KEY);
  if (stored) return stored;

  const envUrl = import.meta.env.VITE_COLAB_URL;
  if (envUrl) return envUrl;

  return '';
}

export function setColabUrl(url) {
  // Clean URL: remove trailing slash
  const clean = url ? url.replace(/\/+$/, '').trim() : '';
  if (clean) {
    localStorage.setItem(COLAB_URL_KEY, clean);
  } else {
    localStorage.removeItem(COLAB_URL_KEY);
  }
  return clean;
}

// Theme persistence
export function getTheme() {
  return localStorage.getItem('valor_theme') || 'light';
}

export function setTheme(theme) {
  localStorage.setItem('valor_theme', theme);
}
