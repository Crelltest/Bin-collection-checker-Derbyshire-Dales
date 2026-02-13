// LIVE adapter for Derbyshire Dales bin collections
// Uses the council's FREE address lookup API - no external service needed!
// Flow: Postcode → Council API (get UPRN) → Council API (get collections)

const fetch = require('node-fetch');

// In-memory cache with TTL
const cache = new Map();
const COLLECTION_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const ADDRESS_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days (addresses rarely change)

function getCached(key, ttl = COLLECTION_CACHE_TTL) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < ttl) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data, ttl = COLLECTION_CACHE_TTL) {
  cache.set(key, { data, timestamp: Date.now() });
}

// Get addresses and UPRNs from council's FREE address lookup API
async function getAddressesFromCouncil(postcode) {
  const cacheKey = `addresses_${postcode.replace(/\s+/g, '').toUpperCase()}`;
  const cached = getCached(cacheKey, ADDRESS_CACHE_TTL);
  if (cached) return cached;

  try {
    const url = 'https://selfserve.derbyshiredales.gov.uk/core/addresslookup';

    const formData = new URLSearchParams({
      query: postcode,
      searchNlpg: 'True',
      manualaddressentry: 'False',
      classification: ''
    });

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://selfserve.derbyshiredales.gov.uk/'
      },
      body: formData.toString(),
      timeout: 5000
    });

    if (!resp.ok) throw new Error(`council_api_error_${resp.status}`);

    const data = await resp.json();

    // Convert to array format: [{uprn, address}, ...]
    const addresses = Object.entries(data).map(([uprn, address]) => ({
      uprn: uprn.replace(/^U/, ''), // Remove 'U' prefix
      uprnWithPrefix: uprn,
      address: address
    }));

    if (addresses.length === 0) {
      throw new Error('no_addresses_found');
    }

    setCache(cacheKey, addresses, ADDRESS_CACHE_TTL);
    return addresses;

  } catch (err) {
    console.error('Address lookup error:', err.message);
    return null;
  }
}

// Get collection dates from council API using UPRN
async function getCollectionsFromCouncil(uprn, uprnWithPrefix) {
  const cacheKey = `collections_${uprn}`;
  const cached = getCached(cacheKey, COLLECTION_CACHE_TTL);
  if (cached) return cached;

  try {
    // Step 1: Get form tokens
    const formUrl = 'https://selfserve.derbyshiredales.gov.uk/renderform.aspx?t=103&k=9644C066D2168A4C21BCDA351DA2642526359DFF';
    const formResp = await fetch(formUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });

    if (!formResp.ok) throw new Error('council_form_unavailable');

    const formHtml = await formResp.text();
    const cookies = formResp.headers.raw()['set-cookie'];

    // Extract hidden form fields
    function extractField(html, fieldName) {
      const pattern = new RegExp(`name="${fieldName}"[^>]*value="([^"]*)"`, 'i');
      const match = html.match(pattern);
      return match ? match[1] : '';
    }

    const requestToken = extractField(formHtml, '__RequestVerificationToken');
    const formGuid = extractField(formHtml, 'FormGuid');
    const objectTemplateId = extractField(formHtml, 'ObjectTemplateID');
    const currentSectionId = extractField(formHtml, 'CurrentSectionID');

    // Step 2: Submit with UPRN (must include ALL required fields!)
    const submitUrl = 'https://selfserve.derbyshiredales.gov.uk/renderform/Form';

    // Extract postcode from the UPRN's address (we need to pass it back)
    const addressCacheKeys = Array.from(cache.keys()).filter(k => k.startsWith('addresses_'));
    let postcodeForForm = '';
    if (addressCacheKeys.length > 0) {
      const addresses = cache.get(addressCacheKeys[0])?.data;
      if (addresses && addresses[0]) {
        const addressParts = addresses[0].address.split(',');
        postcodeForForm = addressParts[addressParts.length - 1].trim();
      }
    }

    const formData = new URLSearchParams({
      '__RequestVerificationToken': requestToken,
      'FormGuid': formGuid,
      'ObjectTemplateID': objectTemplateId,
      'Trigger': 'submit', // Correct field name!
      'CurrentSectionID': currentSectionId,
      'TriggerCtl': '',
      'FF2924': uprnWithPrefix, // UPRN with 'U' prefix
      'FF2924lbltxt': 'Collection address',
      'FF2924-text': postcodeForForm // Postcode required!
    });

    const submitResp = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': formUrl,
        'Cookie': cookies ? cookies.join('; ') : ''
      },
      body: formData.toString(),
      timeout: 30000 // Increased to 30s - council API can be slow
    });

    if (!submitResp.ok) throw new Error(`council_submit_failed_${submitResp.status}`);

    const resultHtml = await submitResp.text();

    // Step 3: Parse collection dates from HTML
    const collections = parseCollectionDates(resultHtml);

    if (collections.length > 0) {
      setCache(cacheKey, collections, COLLECTION_CACHE_TTL);
      return collections;
    }

    return null;

  } catch (err) {
    console.error('Collections API error:', err.message);
    return null;
  }
}

// Parse collection dates from council HTML response
// Format: <div class="col-sm-5"><strong>Tuesday</strong> 17 February, 2026</div>
//         <div class="col-sm-6"><strong>Domestic Waste 140L Bin</strong></div>
function parseCollectionDates(html) {
  const collections = [];

  // Extract all date-type pairs from the HTML
  // Pattern: col-sm-5 contains date, col-sm-6 contains bin type
  const rowPattern = /<div class="col-sm-5"><strong>\w+<\/strong>\s+(\d{1,2}\s+\w+,?\s+\d{4})<\/div><div class="col-sm-6"><strong>([^<]+)<\/strong>/gi;

  let match;
  while ((match = rowPattern.exec(html)) !== null) {
    const dateStr = match[1].trim(); // "17 February, 2026"
    const binType = match[2].trim(); // "Domestic Waste 140L Bin"

    // Normalize the bin type to simple categories
    let type = 'Other';
    if (binType.toLowerCase().includes('domestic') || binType.toLowerCase().includes('refuse')) {
      type = 'Refuse';
    } else if (binType.toLowerCase().includes('recycling')) {
      type = 'Recycling';
    } else if (binType.toLowerCase().includes('garden')) {
      type = 'Garden';
    } else if (binType.toLowerCase().includes('food')) {
      type = 'Food';
    }

    const date = normalizeDate(dateStr);

    if (date) {
      // Group multiple collections on same date
      const existing = collections.find(c => c.date === date && c.type === type);
      if (!existing) {
        collections.push({ type, date });
      }
    }
  }

  // Sort by date
  collections.sort((a, b) => a.date.localeCompare(b.date));

  return collections;
}

// Normalize various date formats to YYYY-MM-DD
function normalizeDate(dateStr) {
  try {
    // Clean up the string
    const cleaned = dateStr.replace(/\s+/g, ' ').trim();

    // Try parsing "16 February 2026" or "16 February, 2026"
    const monthNames = {
      'january': '01', 'february': '02', 'march': '03', 'april': '04',
      'may': '05', 'june': '06', 'july': '07', 'august': '08',
      'september': '09', 'october': '10', 'november': '11', 'december': '12',
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
      'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09',
      'oct': '10', 'nov': '11', 'dec': '12'
    };

    // Pattern: "DD Month YYYY" or "DD Month, YYYY"
    const monthPattern = /(\d{1,2})\s+(\w+),?\s+(\d{4})/i;
    const monthMatch = cleaned.match(monthPattern);
    if (monthMatch) {
      const day = monthMatch[1].padStart(2, '0');
      const monthName = monthMatch[2].toLowerCase();
      const year = monthMatch[3];
      const month = monthNames[monthName];

      if (month) {
        return `${year}-${month}-${day}`;
      }
    }

    // Pattern: "DD/MM/YYYY" or "DD-MM-YYYY"
    const slashPattern = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
    const slashMatch = cleaned.match(slashPattern);
    if (slashMatch) {
      const day = slashMatch[1].padStart(2, '0');
      const month = slashMatch[2].padStart(2, '0');
      let year = slashMatch[3];
      if (year.length === 2) year = '20' + year;
      return `${year}-${month}-${day}`;
    }

  } catch (err) {
    // Invalid date format
  }

  return null;
}

// Main function: Get collections for a postcode using LIVE council data!
async function getCollectionsForPostcode(postcode) {
  const normalizedPostcode = postcode.trim().replace(/\s+/g, ' ').toUpperCase();

  try {
    // Step 1: Get addresses and UPRNs from council
    console.log(`Looking up addresses for ${normalizedPostcode}...`);
    const addresses = await getAddressesFromCouncil(normalizedPostcode);

    if (!addresses || addresses.length === 0) {
      throw new Error('No addresses found for this postcode');
    }

    console.log(`Found ${addresses.length} addresses`);

    // Step 2: Use first address to get collections
    // (In a real app, you'd let the user select which address)
    const firstAddress = addresses[0];
    console.log(`Using: ${firstAddress.address}`);

    const collections = await getCollectionsFromCouncil(firstAddress.uprn, firstAddress.uprnWithPrefix);

    if (collections && collections.length > 0) {
      // SUCCESS! Return real council data
      return {
        postcode: normalizedPostcode,
        address: firstAddress.address,
        uprn: firstAddress.uprn,
        collections: collections,
        addressCount: addresses.length,
        note: `Live data from Derbyshire Dales District Council. ${addresses.length > 1 ? `(${addresses.length} addresses found - showing first)` : ''}`
      };
    }

    // Collections API failed, but we have address
    console.log('Collections API failed, returning address only');
    return {
      postcode: normalizedPostcode,
      address: firstAddress.address,
      uprn: firstAddress.uprn,
      collections: [
        { type: 'Refuse', date: '2026-02-20' },
        { type: 'Recycling', date: '2026-02-27' }
      ],
      addressCount: addresses.length,
      note: `Address verified via council API. Collection dates temporarily unavailable - showing mock data.`
    };

  } catch (err) {
    console.error('Error:', err.message);

    // Fallback to mock data with error info
    return {
      postcode: normalizedPostcode,
      address: 'Address lookup failed',
      collections: [
        { type: 'Refuse', date: '2026-02-20' },
        { type: 'Recycling', date: '2026-02-27' }
      ],
      note: `Unable to fetch data from council API. Error: ${err.message}. Please check the postcode and try again.`
    };
  }
}

module.exports = { getCollectionsForPostcode };
