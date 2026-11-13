const DEFAULT_MERCURY_BILL_PAY_EMAIL = 'lingohabit@ap.mercury.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    const mercuryEmail = process.env.MERCURY_BILL_PAY_EMAIL || DEFAULT_MERCURY_BILL_PAY_EMAIL;
    if (!apiKey || !from) return res.status(500).json({ error: 'Resend is not configured' });

    const { subject, body, filename, pdfBase64 } = req.body || {};
    if (!subject || !body || !filename || !pdfBase64) {
      return res.status(400).json({ error: 'Missing invoice email fields' });
    }

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [mercuryEmail],
        subject,
        text: body,
        attachments: [{ filename, content: pdfBase64 }]
      })
    });

    const responseText = await resendResponse.text();
    if (!resendResponse.ok) {
      console.error('Resend Mercury send failed', responseText);
      return res.status(502).json({ error: 'Resend send failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mercury invoice send failed', error);
    return res.status(500).json({ error: 'Failed to send to Mercury' });
  }
};
