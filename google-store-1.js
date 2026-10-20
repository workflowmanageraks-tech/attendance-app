'use strict';
// Talks to the Google Sheets REST API using a Service Account (no npm packages needed).
const crypto = require('crypto');
const b64u = x => Buffer.from(x).toString('base64url');

class GoogleStore {
  constructor({ email, key, sheetId }) { this.email = email; this.key = key.replace(/\\n/g, '\n'); this.sheetId = sheetId; this.tok = ''; this.exp = 0; }
  async token() {
    if (this.tok && Date.now() < this.exp - 60000) return this.tok;
    const now = Math.floor(Date.now() / 1000);
    const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const body = b64u(JSON.stringify({ iss: this.email, scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
    const sig = crypto.createSign('RSA-SHA256').update(head + '.' + body).sign(this.key, 'base64url');
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + head + '.' + body + '.' + sig });
    const j = await r.json();
    if (!j.access_token) throw new Error('Google login failed: ' + (j.error_description || j.error || 'unknown'));
    this.tok = j.access_token; this.exp = Date.now() + (j.expires_in || 3600) * 1000;
    return this.tok;
  }
  async call(path, opt) {
    const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets/' + this.sheetId + path,
      Object.assign({ headers: { Authorization: 'Bearer ' + await this.token(), 'Content-Type': 'application/json' } }, opt));
    const j = await r.json();
    if (!r.ok) throw new Error('Sheets API: ' + ((j.error && j.error.message) || r.status));
    return j;
  }
  async load() {
    const meta = await this.call('?fields=sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))');
    const props = meta.sheets.map(s => s.properties);
    const q = props.map(p => 'ranges=' + encodeURIComponent("'" + p.title.replace(/'/g, "''") + "'")).join('&');
    const vals = await this.call('/values:batchGet?' + q + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING');
    return props.map((p, i) => ({ id: p.sheetId, title: p.title, rows: p.gridProperties.rowCount, cols: p.gridProperties.columnCount,
      values: (vals.valueRanges[i] && vals.valueRanges[i].values) || [] }));
  }
  async flush(requests) { await this.call(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }); }
}
module.exports = { GoogleStore };
