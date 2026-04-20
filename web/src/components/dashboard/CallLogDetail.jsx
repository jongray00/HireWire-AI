export default function CallLogDetail({ log }) {
  if (!log) return null;

  const actions = log.actions || [];

  const customerInfo = actions.find(a => a.action_type === 'customer_info');
  const messages = actions.filter(a => a.action_type === 'message');
  const callbacks = actions.filter(a => a.action_type === 'callback');
  const emailsSent = actions.filter(a => a.action_type === 'email_sent');
  const smsSent = actions.filter(a => a.action_type === 'sms_sent');

  return (
    <div className="px-4 py-3 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
      {/* Customer Info */}
      {customerInfo && (
        <div className="p-3 mb-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Customer Info</div>
          {customerInfo.data.name && <div className="flex gap-2 text-sm text-gray-900 dark:text-gray-100 mb-0.5"><strong>Name:</strong> {customerInfo.data.name}</div>}
          {customerInfo.data.email && <div className="flex gap-2 text-sm text-gray-900 dark:text-gray-100 mb-0.5"><strong>Email:</strong> {customerInfo.data.email}</div>}
          {customerInfo.data.phone && <div className="flex gap-2 text-sm text-gray-900 dark:text-gray-100 mb-0.5"><strong>Phone:</strong> {customerInfo.data.phone}</div>}
          {customerInfo.data.company && <div className="flex gap-2 text-sm text-gray-900 dark:text-gray-100 mb-0.5"><strong>Company:</strong> {customerInfo.data.company}</div>}
          {customerInfo.data.notes && <div className="flex gap-2 text-sm text-gray-900 dark:text-gray-100 mb-0.5"><strong>Notes:</strong> {customerInfo.data.notes}</div>}
        </div>
      )}

      {/* Call Summary */}
      {log.summary && (
        <div className="p-3 mb-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Call Summary</div>
          <p className="text-sm text-gray-900 dark:text-gray-100 m-0">{log.summary}</p>
          {log.caller_intent && (
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 m-0">
              <strong>Intent:</strong> {log.caller_intent}
            </p>
          )}
          {log.follow_up && (
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-1 m-0">
              <strong>Follow-up:</strong> {log.follow_up}
            </p>
          )}
        </div>
      )}

      {/* Messages Taken */}
      {messages.length > 0 && (
        <div className="p-3 mb-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Messages Taken</div>
          {messages.map((m, i) => (
            <div key={i} className="mb-1.5 text-sm text-gray-900 dark:text-gray-100">
              <strong>{m.data.name || 'Caller'}:</strong> "{m.data.message}"
              {m.data.number && <span className="text-gray-500 dark:text-gray-400"> — callback: {m.data.number}</span>}
            </div>
          ))}
        </div>
      )}

      {/* Callbacks Scheduled */}
      {callbacks.length > 0 && (
        <div className="p-3 mb-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Callbacks Scheduled</div>
          {callbacks.map((c, i) => (
            <div key={i} className="text-sm text-gray-900 dark:text-gray-100 mb-1.5">
              <strong>{c.data.name}</strong> — {c.data.time}
              {c.data.number && <span className="text-gray-500 dark:text-gray-400"> ({c.data.number})</span>}
              {c.data.reason && <div className="text-gray-500 dark:text-gray-400 text-xs">Reason: {c.data.reason}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Emails Sent */}
      {emailsSent.length > 0 && (
        <div className="p-3 mb-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">Emails Sent</div>
          {emailsSent.map((e, i) => (
            <div key={i} className="text-sm text-gray-900 dark:text-gray-100 mb-1.5">
              To: <strong>{e.data.to || e.data.to_email}</strong>
              {e.data.subject && <span> — "{e.data.subject}"</span>}
              <span className={`ml-2 text-xs ${e.data.status === 'sent' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                ({e.data.status || 'sent'})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* SMS Sent */}
      {smsSent.length > 0 && (
        <div className="p-3 mb-2 rounded-md border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          <div className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5">SMS Sent</div>
          {smsSent.map((s, i) => (
            <div key={i} className="text-sm text-gray-900 dark:text-gray-100 mb-1.5">
              To: <strong>{s.data.to || s.data.phone_number}</strong>
              {s.data.body && <div className="text-gray-500 dark:text-gray-400 text-xs">"{(s.data.body || '').slice(0, 100)}"</div>}
            </div>
          ))}
        </div>
      )}

      {/* Topics */}
      {log.topics && (
        <div className="flex gap-1 flex-wrap mt-2">
          {(typeof log.topics === 'string' ? JSON.parse(log.topics) : log.topics).map((topic, i) => (
            <span
              key={i}
              className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-900/40 text-indigo-800 dark:text-indigo-300 rounded-full text-xs font-medium"
            >
              {topic}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
