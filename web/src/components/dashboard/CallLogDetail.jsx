export default function CallLogDetail({ log }) {
  if (!log) return null;

  const actions = log.actions || [];

  const customerInfo = actions.find(a => a.action_type === 'customer_info');
  const messages = actions.filter(a => a.action_type === 'message');
  const callbacks = actions.filter(a => a.action_type === 'callback');
  const emailsSent = actions.filter(a => a.action_type === 'email_sent');
  const smsSent = actions.filter(a => a.action_type === 'sms_sent');

  const sectionStyle = {
    padding: '0.75rem',
    marginBottom: '0.5rem',
    borderRadius: '0.375rem',
    border: '1px solid #e5e7eb',
    backgroundColor: '#fafafa',
  };

  const headingStyle = {
    fontSize: '0.8rem',
    fontWeight: 700,
    marginBottom: '0.375rem',
    textTransform: 'uppercase',
    letterSpacing: '0.03em',
    color: '#555',
  };

  const fieldStyle = {
    display: 'flex',
    gap: '0.5rem',
    fontSize: '0.85rem',
    marginBottom: '0.125rem',
  };

  return (
    <div style={{ padding: '0.75rem 1rem', backgroundColor: '#fff', borderTop: '1px solid #e5e7eb' }}>
      {/* Customer Info */}
      {customerInfo && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Customer Info</div>
          {customerInfo.data.name && <div style={fieldStyle}><strong>Name:</strong> {customerInfo.data.name}</div>}
          {customerInfo.data.email && <div style={fieldStyle}><strong>Email:</strong> {customerInfo.data.email}</div>}
          {customerInfo.data.phone && <div style={fieldStyle}><strong>Phone:</strong> {customerInfo.data.phone}</div>}
          {customerInfo.data.company && <div style={fieldStyle}><strong>Company:</strong> {customerInfo.data.company}</div>}
          {customerInfo.data.notes && <div style={fieldStyle}><strong>Notes:</strong> {customerInfo.data.notes}</div>}
        </div>
      )}

      {/* Call Summary */}
      {log.summary && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Call Summary</div>
          <p style={{ fontSize: '0.85rem', margin: 0 }}>{log.summary}</p>
          {log.caller_intent && (
            <p style={{ fontSize: '0.8rem', color: '#666', marginTop: '0.25rem', margin: 0 }}>
              <strong>Intent:</strong> {log.caller_intent}
            </p>
          )}
          {log.follow_up && (
            <p style={{ fontSize: '0.8rem', color: '#b45309', marginTop: '0.25rem', margin: 0 }}>
              <strong>Follow-up:</strong> {log.follow_up}
            </p>
          )}
        </div>
      )}

      {/* Messages Taken */}
      {messages.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Messages Taken</div>
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: '0.375rem', fontSize: '0.85rem' }}>
              <strong>{m.data.name || 'Caller'}:</strong> "{m.data.message}"
              {m.data.number && <span style={{ color: '#666' }}> — callback: {m.data.number}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Callbacks Scheduled */}
      {callbacks.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Callbacks Scheduled</div>
          {callbacks.map((c, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.375rem' }}>
              <strong>{c.data.name}</strong> — {c.data.time}
              {c.data.number && <span style={{ color: '#666' }}> ({c.data.number})</span>}
              {c.data.reason && <div style={{ color: '#666', fontSize: '0.8rem' }}>Reason: {c.data.reason}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Emails Sent */}
      {emailsSent.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>Emails Sent</div>
          {emailsSent.map((e, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.375rem' }}>
              To: <strong>{e.data.to || e.data.to_email}</strong>
              {e.data.subject && <span> — "{e.data.subject}"</span>}
              <span style={{ color: e.data.status === 'sent' ? '#16a34a' : '#dc2626', marginLeft: '0.5rem', fontSize: '0.75rem' }}>
                ({e.data.status || 'sent'})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* SMS Sent */}
      {smsSent.length > 0 && (
        <div style={sectionStyle}>
          <div style={headingStyle}>SMS Sent</div>
          {smsSent.map((s, i) => (
            <div key={i} style={{ fontSize: '0.85rem', marginBottom: '0.375rem' }}>
              To: <strong>{s.data.to || s.data.phone_number}</strong>
              {s.data.body && <div style={{ color: '#666', fontSize: '0.8rem' }}>"{(s.data.body || '').slice(0, 100)}"</div>}
            </div>
          ))}
        </div>
      )}

      {/* Topics */}
      {log.topics && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {(typeof log.topics === 'string' ? JSON.parse(log.topics) : log.topics).map((topic, i) => (
            <span
              key={i}
              style={{
                padding: '0.125rem 0.5rem',
                backgroundColor: '#e0e7ff',
                color: '#3730a3',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 500,
              }}
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
