
function escapeHtml(value = '') {
  return String(value || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function normalizeReminderEmail(subject, body, html) {
  if (!/Upcoming Session Reminder/i.test(String(subject || ''))) return { text: body, html };
  const warningLead = 'The timezone and time conversion shown here are generated automatically by the app.';
  const warningBold = 'Coaches are advised to double-check the accuracy';
  const warningTail = 'especially in cases of daylight saving time changes or local timezone adjustments. If any discrepancy or inaccurate timing is noticed, please inform the team so it can be corrected.';
  const warningText = `${warningLead} ${warningBold}, ${warningTail}`;
  const rawLines = String(body || '').replace(/\r/g, '').split('\n');
  const lines = rawLines.filter(line => !line.includes('The timezone and time conversion shown here are generated automatically'));
  const notesIdx = lines.findIndex(line => /^Notes\s*$/i.test(line.trim()));
  if (notesIdx >= 0) {
    lines.splice(notesIdx, 0, '', warningText, '');
  } else {
    lines.push('', warningText);
  }
  const text = lines.join('\n').replace(/\n{4,}/g, '\n\n\n');

  const coach = [];
  const student = [];
  let difference = '';
  const notes = [];
  let section = 'coach';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^Student\s*\(/i.test(trimmed)) section = 'student';
    if (/^Time Difference:/i.test(trimmed)) { section = 'difference'; difference = trimmed; continue; }
    if (trimmed === warningText) { section = 'warning'; continue; }
    if (/^Notes$/i.test(trimmed)) { section = 'notes'; continue; }
    if (section === 'coach') coach.push(trimmed);
    else if (section === 'student') student.push(trimmed);
    else if (section === 'notes' && trimmed.startsWith('-')) notes.push(trimmed.replace(/^[-•]\s*/, ''));
  }
  const scheduleNote = 'If there are any changes in the schedule, please update the student and the profile sheet.';
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.45;color:#111827">
      <p style="margin:0 0 18px"><strong>${coach.map(escapeHtml).join('<br>')}</strong></p>
      <p style="margin:0 0 18px">${student.map(escapeHtml).join('<br>')}</p>
      <p style="margin:0 0 18px">${escapeHtml(difference)}</p>
      <p style="margin:0 0 18px"><em>${escapeHtml(warningLead)} <strong>${escapeHtml(warningBold)}</strong>, ${escapeHtml(warningTail)}</em></p>
      <p style="margin:0 0 6px">Notes</p>
      <ul style="margin:0;padding-left:20px">
        ${(notes.length ? notes : [
          'This is a 24-hour advance reminder for the upcoming session.',
          scheduleNote,
          'Please ensure availability and readiness for the session.'
        ]).map(note => `<li${note === scheduleNote ? ' style="color:#B91C1C"' : ''}>${escapeHtml(note)}</li>`).join('')}
      </ul>
    </div>`;
  return { text, html: htmlBody };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;

    if (!apiKey || !from) {
      console.error('Session notification email is not configured.');
      return res.status(500).json({ error: 'Email service is not configured' });
    }

    const { to, subject, body, html, idempotencyKey, cancelId } = req.body || {};
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);

    if (!recipients.length || !subject || !body) {
      return res.status(400).json({ error: 'Missing notification email fields' });
    }

    if (cancelId) {
      const cancelResponse = await fetch(`https://api.resend.com/emails/${encodeURIComponent(cancelId)}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` }
      }).catch(error => {
        console.warn('Unable to cancel previous scheduled reminder before immediate send:', error);
        return null;
      });
      if (!cancelResponse || !cancelResponse.ok) {
        const cancelText = cancelResponse ? await cancelResponse.text().catch(() => '') : '';
        console.error('Previous scheduled reminder could not be canceled before immediate send:', cancelText);
        return res.status(409).json({ error: 'Existing scheduled reminder could not be canceled. Please try again.' });
      }
    }

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    };
    if (idempotencyKey) headers['Idempotency-Key'] = String(idempotencyKey).slice(0, 256);

    const normalizedEmail = normalizeReminderEmail(subject, body, html);

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        text: normalizedEmail.text,
        html: normalizedEmail.html
      })
    });

    const responseText = await resendResponse.text();

    if (!resendResponse.ok) {
      console.error('Resend session notification send failed:', responseText);
      return res.status(502).json({ error: 'Email send failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Session notification send failed:', error);
    return res.status(500).json({ error: 'Failed to send session notification' });
  }
};