const el = id => document.getElementById(id);

// Bin type emoji/icons
const binIcons = {
  'Refuse': '🗑️',
  'Recycling': '♻️',
  'Garden': '🌱',
  'Food': '🥫',
  'Other': '📦'
};

// Format date nicely
function formatDate(dateStr) {
  const date = new Date(dateStr);
  const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString('en-GB', options);
}

// Calculate days until collection
function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const collectionDate = new Date(dateStr);
  const diffTime = collectionDate - today;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today!';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays < 0) return 'Past';
  return `In ${diffDays} days`;
}

async function fetchCollections() {
  const postcode = el('postcode').value.trim();

  // Show loading state
  el('result').innerHTML = `
    <div class="result-card loading">
      <div class="spinner"></div>
      <div>Looking up collections for ${postcode}...</div>
      <div style="font-size: 13px; color: #999; margin-top: 8px;">This may take up to 20 seconds</div>
    </div>
  `;

  try {
    const resp = await fetch(`/api/collections?postcode=${encodeURIComponent(postcode)}`);
    const data = await resp.json();
    renderResult(data);
  } catch (err) {
    el('result').innerHTML = `
      <div class="result-card">
        <div style="text-align: center; padding: 20px; color: #d32f2f;">
          <div style="font-size: 48px; margin-bottom: 12px;">⚠️</div>
          <div style="font-weight: 600; margin-bottom: 8px;">Error loading collections</div>
          <div style="font-size: 14px; color: #666;">${err.message}</div>
        </div>
      </div>
    `;
  }
}

function renderResult(data) {
  if (!data || !data.collections) {
    el('result').innerHTML = '<div class="result-card">No collection data found</div>';
    return;
  }

  // Group collections by date for better display
  const upcoming = data.collections.filter(c => {
    const date = new Date(c.date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  });

  const collectionItems = upcoming.map(c => {
    const typeClass = c.type.toLowerCase();
    const icon = binIcons[c.type] || binIcons['Other'];
    const daysText = daysUntil(c.date);
    const isUrgent = daysText === 'Today!' || daysText === 'Tomorrow';

    return `
      <div class="collection-item ${typeClass}">
        <div class="bin-icon ${typeClass}">${icon}</div>
        <div class="collection-details">
          <div class="collection-type">${c.type} Collection</div>
          <div class="collection-date">
            ${formatDate(c.date)}
            <strong style="color: ${isUrgent ? '#d32f2f' : '#666'}; margin-left: 8px;">
              ${daysText}
            </strong>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const addressInfo = data.addressCount > 1
    ? `${data.addressCount} properties at this postcode`
    : data.addressCount === 1
    ? '1 property at this postcode'
    : '';

  const noteClass = data.note && data.note.includes('Live data') ? 'live' : '';
  const noteIcon = noteClass === 'live' ? '✅' : 'ℹ️';

  el('result').innerHTML = `
    <div class="result-card">
      <div class="address-section">
        <div class="address-label">Collections for</div>
        <div class="address-value">${data.postcode}</div>
        ${addressInfo ? `<div class="postcode-value">${addressInfo}</div>` : ''}
      </div>

      <div class="collections-title">
        <span>📅</span>
        <span>Upcoming Collections</span>
      </div>

      <div class="collections-grid">
        ${collectionItems || '<div style="padding: 20px; text-align: center; color: #999;">No upcoming collections</div>'}
      </div>

      ${data.note ? `<div class="note ${noteClass}">${noteIcon} ${data.note}</div>` : ''}
    </div>
  `;
}

// Event listeners
el('fetch').addEventListener('click', fetchCollections);

el('postcode').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    fetchCollections();
  }
});

// Auto-fetch on load
fetchCollections();
